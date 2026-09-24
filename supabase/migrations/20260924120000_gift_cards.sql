-- Cartes cadeaux MediumIA : achat, envoi, utilisation.
--
-- Migration préparée, à appliquer manuellement par le propriétaire (SQL Editor Supabase).
-- Accès serveur uniquement (clé service_role) : RLS activée sans aucune policy.
--
-- TVA : toutes les prestations concernées sont au même taux (20 %), la carte est donc
-- un « bon à usage unique » : la TVA est comptée à la vente (écriture gift_card_sale).
-- Son utilisation est enregistrée avec payment_method = 'gift_card' pour solder le
-- rendez-vous, mais n'est pas recomptée dans le chiffre d'affaires.

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  code_last4 text not null check (char_length(code_last4) = 4),
  view_token_hash text not null unique,
  kind text not null check (kind in ('amount', 'consultation', 'chronosphere', 'coffret')),
  label text not null check (char_length(label) between 3 and 160),
  price_cents integer not null check (price_cents > 0 and price_cents <= 100000),
  currency text not null default 'EUR' check (currency = 'EUR'),
  consultation_credit_cents integer not null default 0 check (consultation_credit_cents >= 0),
  balance_cents integer not null default 0 check (balance_cents >= 0 and balance_cents <= consultation_credit_cents),
  service_id uuid references public.booking_services(id) on delete set null,
  chronosphere_product text check (chronosphere_product is null or chronosphere_product in ('pack3', 'max3')),
  chronosphere_redeemed_at timestamptz,
  buyer_name text not null check (char_length(buyer_name) between 1 and 80),
  buyer_email text not null check (char_length(buyer_email) between 5 and 254),
  recipient_name text not null check (char_length(recipient_name) between 1 and 80),
  recipient_email text check (recipient_email is null or char_length(recipient_email) between 5 and 254),
  message text check (message is null or char_length(message) <= 400),
  send_on date,
  recipient_sent_at timestamptz,
  buyer_sent_at timestamptz,
  status text not null default 'payment_pending'
    check (status in ('payment_pending', 'active', 'used', 'cancelled')),
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  paypal_order_id text not null unique,
  paypal_capture_id text unique,
  paid_at timestamptz,
  expires_at timestamptz,
  terms_version text not null,
  created_at timestamptz not null default now(),
  constraint gift_cards_paid_state check (
    (status = 'payment_pending' and paypal_capture_id is null and paid_at is null)
    or (status <> 'payment_pending' and paypal_capture_id is not null and paid_at is not null and expires_at is not null)
  )
);

create index if not exists gift_cards_recipient_due_idx
  on public.gift_cards (send_on)
  where status = 'active' and recipient_email is not null and recipient_sent_at is null;

create table if not exists public.gift_card_redemptions (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

-- Code en clair et jeton de la carte à imprimer, nécessaires pour envoyer la carte
-- (à l'acheteur, puis au bénéficiaire à la date choisie). Table séparée, serveur seul.
create table if not exists public.gift_card_delivery_secrets (
  gift_card_id uuid primary key references public.gift_cards(id) on delete cascade,
  code text not null,
  view_token text not null
);

alter table public.gift_cards enable row level security;
alter table public.gift_card_redemptions enable row level security;
alter table public.gift_card_delivery_secrets enable row level security;
revoke all on table public.gift_cards from public, anon, authenticated;
revoke all on table public.gift_card_redemptions from public, anon, authenticated;
revoke all on table public.gift_card_delivery_secrets from public, anon, authenticated;

-- Comptabilité : vente de carte (entry_kind) et utilisation (payment_method).
alter table public.rdv_financial_entries drop constraint if exists rdv_financial_entries_entry_kind_check;
alter table public.rdv_financial_entries add constraint rdv_financial_entries_entry_kind_check
  check (entry_kind in ('arrhes', 'balance', 'full_payment', 'refund', 'arrhes_retained', 'adjustment', 'gift_card_sale'));
alter table public.rdv_financial_entries drop constraint if exists rdv_financial_entries_payment_method_check;
alter table public.rdv_financial_entries add constraint rdv_financial_entries_payment_method_check
  check (payment_method in ('paypal', 'card', 'cash', 'check', 'transfer', 'other', 'gift_card'));
