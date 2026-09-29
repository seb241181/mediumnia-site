-- MediumIA Rendez-vous — créneaux proposés par lien personnel (urgences).
--
-- Le praticien choisit une prestation, un jour et une heure, et envoie un lien
-- personnel. La personne réserve ce créneau et règle l'acompte (ou la séance)
-- par le paiement habituel. Seule l'empreinte SHA-256 du jeton est stockée.
--
-- Additif : aucune donnée existante n'est modifiée. Lecture et écriture
-- réservées au serveur (service_role).

create table if not exists public.booking_slot_offers (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.booking_practitioners(id) on delete cascade,
  service_id uuid not null references public.booking_services(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  customer_first_name text check (customer_first_name is null or char_length(customer_first_name) <= 80),
  status text not null default 'open' check (status in ('open', 'used', 'cancelled')),
  expires_at timestamptz not null,
  used_booking_id uuid references public.bookings(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (expires_at <= starts_at)
);

create index if not exists booking_slot_offers_practitioner_idx
  on public.booking_slot_offers(practitioner_id, starts_at);

alter table public.booking_slot_offers enable row level security;

drop trigger if exists booking_slot_offers_set_updated_at on public.booking_slot_offers;
create trigger booking_slot_offers_set_updated_at
before update on public.booking_slot_offers
for each row execute function public.set_updated_at();

revoke all on table public.booking_slot_offers from public, anon, authenticated;
grant select, insert, update on table public.booking_slot_offers to service_role;

-- La réservation temporaire (paiement en cours) garde la trace du lien :
-- annuler le lien empêche alors aussi la capture d'un paiement commencé.
alter table public.rdv_booking_holds
  add column if not exists slot_offer_id uuid references public.booking_slot_offers(id) on delete set null;

create index if not exists rdv_booking_holds_slot_offer_idx
  on public.rdv_booking_holds(slot_offer_id)
  where slot_offer_id is not null;

-- ── Annulation et capture mutuellement exclusives ───────────────────────────
-- Ordre de verrouillage commun : réservation temporaire (et paiement), puis offre.
-- claim_rdv_deposit_capture verrouille déjà hold + paiement puis passe le hold
-- en « payment_capturing » : ce déclencheur verrouille alors l'offre et refuse
-- (toute la transaction est annulée, aucun appel PayPal /capture) si elle n'est
-- plus ouverte, a expiré ou si le rendez-vous a commencé.
create or replace function public.guard_slot_offer_capture()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_offer public.booking_slot_offers;
begin
  if new.slot_offer_id is null
     or new.status is distinct from 'payment_capturing'
     or old.status is not distinct from 'payment_capturing' then
    return new;
  end if;

  select * into v_offer from public.booking_slot_offers where id = new.slot_offer_id for update;
  if not found then raise exception 'slot_offer_cancelled'; end if;
  if v_offer.status = 'cancelled' then raise exception 'slot_offer_cancelled'; end if;
  if v_offer.status <> 'open' then raise exception 'slot_offer_used'; end if;
  if v_offer.expires_at <= now() or v_offer.starts_at <= now() then raise exception 'slot_offer_expired'; end if;
  return new;
end;
$$;

revoke all on function public.guard_slot_offer_capture() from public, anon, authenticated;

drop trigger if exists rdv_booking_holds_guard_slot_offer on public.rdv_booking_holds;
create trigger rdv_booking_holds_guard_slot_offer
before update of status on public.rdv_booking_holds
for each row execute function public.guard_slot_offer_capture();

-- Annulation atomique d'un lien. Si une capture a déjà réclamé le paiement, on
-- répond « trop tard » ; sinon l'offre est annulée et les paiements en attente
-- expirés dans la même transaction.
create or replace function public.cancel_slot_offer(p_offer_id uuid, p_practitioner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.booking_slot_offers;
begin
  perform 1
  from public.rdv_booking_holds h
  join public.rdv_paypal_payments p on p.hold_id = h.id
  where h.slot_offer_id = p_offer_id
  for update of h, p;
  perform 1 from public.rdv_booking_holds where slot_offer_id = p_offer_id for update;

  select * into v_offer
  from public.booking_slot_offers
  where id = p_offer_id and practitioner_id = p_practitioner_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'offer_not_found'); end if;
  if v_offer.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'offer_not_open'); end if;

  if exists (
    select 1 from public.rdv_booking_holds
    where slot_offer_id = p_offer_id
      and status in ('payment_capturing', 'payment_captured', 'converted')
  ) then
    return jsonb_build_object('ok', false, 'error', 'offer_payment_in_progress');
  end if;

  update public.booking_slot_offers set status = 'cancelled' where id = p_offer_id;
  update public.rdv_paypal_payments p
  set status = 'expired', last_error_code = 'slot_offer_cancelled'
  from public.rdv_booking_holds h
  where p.hold_id = h.id and h.slot_offer_id = p_offer_id and h.status = 'payment_pending';
  update public.rdv_booking_holds
  set status = 'expired'
  where slot_offer_id = p_offer_id and status = 'payment_pending';

  return jsonb_build_object('ok', true);
end;
$$;

-- Avant la capture : si le lien n'est plus valable, expire proprement la
-- réservation temporaire et le paiement, et renvoie le motif.
create or replace function public.release_slot_offer_hold(p_paypal_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hold public.rdv_booking_holds;
  v_offer public.booking_slot_offers;
  v_reason text;
begin
  select h.* into v_hold
  from public.rdv_paypal_payments p
  join public.rdv_booking_holds h on h.id = p.hold_id
  where p.paypal_order_id = p_paypal_order_id
  for update of h, p;
  if not found or v_hold.slot_offer_id is null or v_hold.status <> 'payment_pending' then
    return jsonb_build_object('ok', true, 'released', false);
  end if;

  select * into v_offer from public.booking_slot_offers where id = v_hold.slot_offer_id for update;
  if not found or v_offer.status = 'cancelled' then v_reason := 'offer_cancelled';
  elsif v_offer.status <> 'open' then v_reason := 'offer_used';
  elsif v_offer.expires_at <= now() or v_offer.starts_at <= now() then v_reason := 'offer_expired';
  else
    return jsonb_build_object('ok', true, 'released', false);
  end if;

  update public.rdv_paypal_payments set status = 'expired', last_error_code = 'slot_' || v_reason where hold_id = v_hold.id;
  update public.rdv_booking_holds set status = 'expired' where id = v_hold.id;
  return jsonb_build_object('ok', true, 'released', true, 'error', v_reason);
end;
$$;

revoke all on function public.cancel_slot_offer(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_slot_offer_hold(text) from public, anon, authenticated;
grant execute on function public.cancel_slot_offer(uuid, uuid) to service_role;
grant execute on function public.release_slot_offer_hold(text) to service_role;

comment on table public.booking_slot_offers is
  'Créneaux proposés par lien personnel (urgences). Jeton stocké uniquement en empreinte SHA-256. Serveur uniquement.';

-- Vérification après exécution (attendu : 1, 1, puis 3 fonctions et 1 déclencheur) :
-- select count(*) from information_schema.tables
--   where table_schema = 'public' and table_name = 'booking_slot_offers';
-- select count(*) from information_schema.columns
--   where table_schema = 'public' and table_name = 'rdv_booking_holds' and column_name = 'slot_offer_id';
-- select count(*) from pg_proc where proname in ('guard_slot_offer_capture', 'cancel_slot_offer', 'release_slot_offer_hold');
-- select count(*) from pg_trigger where tgname = 'rdv_booking_holds_guard_slot_offer';
