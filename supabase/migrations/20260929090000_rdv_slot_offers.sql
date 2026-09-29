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

comment on table public.booking_slot_offers is
  'Créneaux proposés par lien personnel (urgences). Jeton stocké uniquement en empreinte SHA-256. Serveur uniquement.';

-- Vérification après exécution (attendu : 1) :
-- select count(*) from information_schema.tables
--   where table_schema = 'public' and table_name = 'booking_slot_offers';
