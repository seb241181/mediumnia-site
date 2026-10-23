-- Pass conférence : accord explicite avant tout envoi de l'offre, accords CGV et
-- accès immédiat avant paiement, renvoi traçable du lien. Additif uniquement.

-- Accord de l'inscrit pour recevoir son Pass et l'offre participants par e-mail.
-- L'inscription seule (consent_transactional) ne vaut pas accord de prospection.
alter table public.conference_registrations
  add column if not exists offer_consent_at timestamptz,
  add column if not exists offer_consent_source text check (offer_consent_source is null or offer_consent_source in ('pass_request', 'manual')),
  add column if not exists offer_consent_version text,
  add column if not exists offer_consent_withdrawn_at timestamptz;

-- Accords recueillis avant la création de la commande PayPal, et suivi des envois.
alter table public.conference_passes
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists immediate_access_accepted_at timestamptz,
  add column if not exists last_sent_at timestamptz,
  add column if not exists send_count integer not null default 0 check (send_count >= 0);

alter table public.conference_pass_events
  drop constraint if exists conference_pass_events_event_name_check;

alter table public.conference_pass_events
  add constraint conference_pass_events_event_name_check
  check (event_name in (
    'pass_issued',
    'pass_opened',
    'offer_viewed',
    'checkout_started',
    'payment_completed',
    'pass_redeemed',
    'pass_expired',
    'pass_requested',
    'pass_resent',
    'pass_email_failed',
    'terms_accepted'
  ));

create index if not exists conference_registrations_offer_consent_idx
  on public.conference_registrations(event_id, offer_consent_at)
  where offer_consent_at is not null and offer_consent_withdrawn_at is null;
