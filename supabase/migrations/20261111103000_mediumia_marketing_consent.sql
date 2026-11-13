-- Consentement aux e-mails commerciaux MediumIA (lot 1 : schéma et règles).
--
-- Deux tables :
--   mediumia_marketing_subscriptions  : l'état ACTUEL, une ligne par adresse.
--   mediumia_marketing_consent_events : le JOURNAL, jamais modifié ni supprimé.
--
-- Statuts (mediumia_marketing_subscriptions.status) :
--   subscribed   = ABONNÉ       consentement positif, adresse vérifiée, actif
--   none         = NON-ABONNÉ   aucun consentement valable
--                               (explicit_refusal_at distingue le refus
--                               explicite de la simple absence de réponse)
--   unsubscribed = DÉSINSCRIT   consentement retiré (liste d'opposition)
--   pending      = À CONFIRMER  case cochée, adresse pas encore prouvée
--
-- Règles :
--   * seul « subscribed » autorise un envoi commercial ;
--   * une adresse désinscrite n'est JAMAIS réabonnée par une réservation ni
--     par un formulaire : seulement par un choix explicite fait depuis
--     l'espace personnel, identité vérifiée ;
--   * créer un compte n'abonne à rien ; rien n'est repris de Reservio ;
--   * toute écriture passe par les fonctions ci-dessous (une seule règle).
--
-- mediumia_customer_consents (référentiel praticien / import Reservio) n'est
-- pas modifiée et ne sert à aucun envoi.
--
-- Réservé au serveur (service_role). Additive et rejouable.

-- ── 1. État actuel ──────────────────────────────────────────────────────────

create table if not exists public.mediumia_marketing_subscriptions (
  email text primary key
    check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  user_id uuid,
  status text not null default 'none'
    check (status in ('none', 'pending', 'subscribed', 'unsubscribed')),
  explicit_refusal_at timestamptz,
  consent_text_version text,
  consent_text_sha256 text check (consent_text_sha256 is null or consent_text_sha256 ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  confirm_token_hash text check (confirm_token_hash is null or confirm_token_hash ~ '^[0-9a-f]{64}$'),
  confirm_token_expires_at timestamptz,
  unsubscribe_token_hash text check (unsubscribe_token_hash is null or unsubscribe_token_hash ~ '^[0-9a-f]{64}$'),
  provider_contact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mediumia_marketing_subscribed_has_proof
    check (status <> 'subscribed' or (confirmed_at is not null and consent_text_version is not null and consent_text_sha256 is not null)),
  constraint mediumia_marketing_pending_has_token
    check (status <> 'pending' or (confirm_token_hash is not null and confirm_token_expires_at is not null)),
  constraint mediumia_marketing_unsubscribed_has_date
    check (status <> 'unsubscribed' or unsubscribed_at is not null)
);

create unique index if not exists uq_mediumia_marketing_confirm_token
  on public.mediumia_marketing_subscriptions (confirm_token_hash) where confirm_token_hash is not null;
create unique index if not exists uq_mediumia_marketing_unsubscribe_token
  on public.mediumia_marketing_subscriptions (unsubscribe_token_hash) where unsubscribe_token_hash is not null;
create index if not exists idx_mediumia_marketing_status
  on public.mediumia_marketing_subscriptions (status);

alter table public.mediumia_marketing_subscriptions enable row level security;
revoke all on table public.mediumia_marketing_subscriptions from public, anon, authenticated;
grant select on table public.mediumia_marketing_subscriptions to service_role;

-- ── 2. Journal (append-only) ────────────────────────────────────────────────

create table if not exists public.mediumia_marketing_consent_events (
  id bigint generated always as identity primary key,
  email text not null check (email = lower(btrim(email))),
  user_id uuid,
  event text not null
    check (event in ('presented_not_given', 'opt_in', 'opt_in_confirmation', 'refused', 'withdrawn')),
  source text not null
    check (source in ('booking', 'account', 'form', 'email_link', 'provider', 'admin')),
  identity_verified boolean not null,
  outcome text not null
    check (outcome in ('unchanged', 'pending', 'subscribed', 'blocked_unsubscribed', 'refusal_recorded', 'unsubscribed')),
  status_before text not null check (status_before in ('none', 'pending', 'subscribed', 'unsubscribed')),
  status_after text not null check (status_after in ('none', 'pending', 'subscribed', 'unsubscribed')),
  consent_text_version text,
  consent_text_sha256 text,
  booking_id uuid,
  hold_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_mediumia_marketing_events_email
  on public.mediumia_marketing_consent_events (email, occurred_at);

alter table public.mediumia_marketing_consent_events enable row level security;
revoke all on table public.mediumia_marketing_consent_events from public, anon, authenticated;
grant select on table public.mediumia_marketing_consent_events to service_role;

create or replace function public.mediumia_marketing_events_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'mediumia_marketing_consent_events is append-only';
end;
$$;

revoke all on function public.mediumia_marketing_events_append_only() from public, anon, authenticated;

drop trigger if exists trg_mediumia_marketing_events_no_change on public.mediumia_marketing_consent_events;
create trigger trg_mediumia_marketing_events_no_change
  before update or delete on public.mediumia_marketing_consent_events
  for each row execute function public.mediumia_marketing_events_append_only();

drop trigger if exists trg_mediumia_marketing_events_no_truncate on public.mediumia_marketing_consent_events;
create trigger trg_mediumia_marketing_events_no_truncate
  before truncate on public.mediumia_marketing_consent_events
  for each statement execute function public.mediumia_marketing_events_append_only();

-- ── 3. Enregistrer un choix (réservation, espace personnel, formulaire) ─────
--
-- p_event :
--   presented_not_given  la case a été présentée et laissée vide (trace seule)
--   opt_in               la personne a coché / dit oui
--   refused              la personne a dit non explicitement
--   withdrawn            la personne retire son consentement
-- p_identity_verified : vrai seulement si l'adresse est prouvée (personne
--   connectée avec cette adresse). Sinon un « opt_in » reste « à confirmer »
--   et exige un jeton de confirmation (haché).

create or replace function public.record_mediumia_marketing_consent(
  p_email text,
  p_user_id uuid,
  p_event text,
  p_source text,
  p_identity_verified boolean,
  p_text_version text default null,
  p_text_sha256 text default null,
  p_booking_id uuid default null,
  p_hold_id uuid default null,
  p_confirm_token_hash text default null,
  p_confirm_token_expires_at timestamptz default null,
  p_unsubscribe_token_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_verified boolean := coalesce(p_identity_verified, false);
  v_now timestamptz := now();
  v_row public.mediumia_marketing_subscriptions;
  v_before text;
  v_after text;
  v_outcome text := 'unchanged';
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;
  if p_event is null or p_event not in ('presented_not_given', 'opt_in', 'refused', 'withdrawn')
     or p_source is null or p_source not in ('booking', 'account', 'form', 'email_link', 'provider', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'invalid_consent_event');
  end if;
  if p_event in ('presented_not_given', 'opt_in')
     and (nullif(btrim(coalesce(p_text_version, '')), '') is null or coalesce(p_text_sha256, '') !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('ok', false, 'error', 'consent_text_required');
  end if;

  insert into public.mediumia_marketing_subscriptions (email) values (v_email)
  on conflict (email) do nothing;
  select * into v_row from public.mediumia_marketing_subscriptions where email = v_email for update;
  v_before := v_row.status;
  v_after := v_row.status;

  if p_event = 'opt_in' then
    if v_row.status = 'unsubscribed' and not (p_source = 'account' and v_verified) then
      -- Désinscrit : jamais réabonné par une réservation ou un formulaire.
      v_outcome := 'blocked_unsubscribed';
    elsif v_row.status = 'subscribed' then
      v_outcome := 'unchanged';
    elsif v_verified then
      v_after := 'subscribed';
      v_outcome := 'subscribed';
      update public.mediumia_marketing_subscriptions set
        status = 'subscribed',
        user_id = coalesce(p_user_id, user_id),
        explicit_refusal_at = null,
        consent_text_version = p_text_version,
        consent_text_sha256 = p_text_sha256,
        requested_at = v_now,
        confirmed_at = v_now,
        unsubscribed_at = null,
        confirm_token_hash = null,
        confirm_token_expires_at = null,
        unsubscribe_token_hash = coalesce(unsubscribe_token_hash, p_unsubscribe_token_hash),
        updated_at = v_now
      where email = v_email;
    else
      if coalesce(p_confirm_token_hash, '') !~ '^[0-9a-f]{64}$'
         or p_confirm_token_expires_at is null or p_confirm_token_expires_at <= v_now then
        return jsonb_build_object('ok', false, 'error', 'confirm_token_required');
      end if;
      v_after := 'pending';
      v_outcome := 'pending';
      update public.mediumia_marketing_subscriptions set
        status = 'pending',
        consent_text_version = p_text_version,
        consent_text_sha256 = p_text_sha256,
        requested_at = v_now,
        confirmed_at = null,
        confirm_token_hash = p_confirm_token_hash,
        confirm_token_expires_at = p_confirm_token_expires_at,
        unsubscribe_token_hash = coalesce(unsubscribe_token_hash, p_unsubscribe_token_hash),
        updated_at = v_now
      where email = v_email;
    end if;

  elsif p_event = 'refused' then
    if v_row.status in ('subscribed', 'pending') then
      v_after := 'unsubscribed';
      v_outcome := 'unsubscribed';
    else
      v_outcome := 'refusal_recorded';
    end if;
    update public.mediumia_marketing_subscriptions set
      status = v_after,
      explicit_refusal_at = v_now,
      unsubscribed_at = case when v_after = 'unsubscribed' then coalesce(unsubscribed_at, v_now) else unsubscribed_at end,
      confirm_token_hash = null,
      confirm_token_expires_at = null,
      updated_at = v_now
    where email = v_email;

  elsif p_event = 'withdrawn' then
    v_after := 'unsubscribed';
    v_outcome := case when v_before = 'unsubscribed' then 'unchanged' else 'unsubscribed' end;
    update public.mediumia_marketing_subscriptions set
      status = 'unsubscribed',
      unsubscribed_at = coalesce(case when v_before = 'unsubscribed' then unsubscribed_at end, v_now),
      confirm_token_hash = null,
      confirm_token_expires_at = null,
      updated_at = v_now
    where email = v_email;
  end if;

  insert into public.mediumia_marketing_consent_events (
    email, user_id, event, source, identity_verified, outcome, status_before, status_after,
    consent_text_version, consent_text_sha256, booking_id, hold_id, occurred_at
  ) values (
    v_email, p_user_id, p_event, p_source, v_verified, v_outcome, v_before, v_after,
    p_text_version, p_text_sha256, p_booking_id, p_hold_id, v_now
  );

  return jsonb_build_object('ok', true, 'outcome', v_outcome, 'status', v_after);
end;
$$;

-- ── 4. Confirmer par le lien reçu par e-mail (double confirmation) ──────────
-- Le jeton prouve l'accès à la boîte aux lettres. Usage unique.

create or replace function public.confirm_mediumia_marketing_consent(p_confirm_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_row public.mediumia_marketing_subscriptions;
begin
  if coalesce(p_confirm_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  select * into v_row from public.mediumia_marketing_subscriptions
  where confirm_token_hash = p_confirm_token_hash for update;
  if v_row.email is null or v_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  if v_row.confirm_token_expires_at <= v_now then
    return jsonb_build_object('ok', false, 'error', 'token_expired');
  end if;

  update public.mediumia_marketing_subscriptions set
    status = 'subscribed',
    explicit_refusal_at = null,
    confirmed_at = v_now,
    unsubscribed_at = null,
    confirm_token_hash = null,
    confirm_token_expires_at = null,
    updated_at = v_now
  where email = v_row.email;

  insert into public.mediumia_marketing_consent_events (
    email, user_id, event, source, identity_verified, outcome, status_before, status_after,
    consent_text_version, consent_text_sha256, occurred_at
  ) values (
    v_row.email, v_row.user_id, 'opt_in_confirmation', 'email_link', true, 'subscribed', 'pending', 'subscribed',
    v_row.consent_text_version, v_row.consent_text_sha256, v_now
  );

  return jsonb_build_object('ok', true, 'outcome', 'subscribed', 'status', 'subscribed');
end;
$$;

-- ── 5. Se désinscrire par le lien présent dans chaque e-mail commercial ─────
-- Rejouable : un second clic ne change rien et ne révèle rien.

create or replace function public.withdraw_mediumia_marketing_consent_by_token(p_unsubscribe_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  if coalesce(p_unsubscribe_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  select s.email into v_email from public.mediumia_marketing_subscriptions s
  where s.unsubscribe_token_hash = p_unsubscribe_token_hash;
  if v_email is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  return public.record_mediumia_marketing_consent(v_email, null, 'withdrawn', 'email_link', true);
end;
$$;

revoke all on function public.record_mediumia_marketing_consent(text, uuid, text, text, boolean, text, text, uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.confirm_mediumia_marketing_consent(text) from public, anon, authenticated;
revoke all on function public.withdraw_mediumia_marketing_consent_by_token(text) from public, anon, authenticated;
grant execute on function public.record_mediumia_marketing_consent(text, uuid, text, text, boolean, text, text, uuid, uuid, text, timestamptz, text) to service_role;
grant execute on function public.confirm_mediumia_marketing_consent(text) to service_role;
grant execute on function public.withdraw_mediumia_marketing_consent_by_token(text) to service_role;
