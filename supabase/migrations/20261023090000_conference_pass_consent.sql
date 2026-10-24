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
    'terms_accepted',
    'confirmation_sent',
    'confirmation_failed',
    'pdf_sent',
    'pdf_failed'
  ));

-- Date limite des demandes de Pass (au-delà, l'offre participants est close).
alter table public.conference_events
  add column if not exists pass_request_deadline timestamptz;

update public.conference_events
   set pass_request_deadline = '2026-11-21T23:59:59+01:00'
 where slug = 'premiere-conference-mediumia'
   and pass_request_deadline is null;

create index if not exists conference_registrations_offer_consent_idx
  on public.conference_registrations(event_id, offer_consent_at)
  where offer_consent_at is not null and offer_consent_withdrawn_at is null;

-- PDF personnel : un achat avec Pass (499 € en Live) est enregistré comme une
-- Formation complète pour réutiliser le circuit existant de téléchargement du PDF.
-- Les montants déjà autorisés (597 €, 568 €, 29 €, 1 € en Sandbox) sont inchangés.
do $$
begin
  if to_regclass('public.mediumia_paypal_purchases') is not null then
    alter table public.mediumia_paypal_purchases
      drop constraint if exists mediumia_paypal_purchases_product_amount_check;
    alter table public.mediumia_paypal_purchases
      add constraint mediumia_paypal_purchases_product_amount_check
      check (
        (paypal_env = 'sandbox' and amount_cents = 100)
        or (paypal_env = 'live' and product_code = 'full' and amount_cents in (59700, 56800, 49900))
        or (paypal_env = 'live' and product_code = 'discovery' and amount_cents = 2900)
      );
  end if;
end $$;
