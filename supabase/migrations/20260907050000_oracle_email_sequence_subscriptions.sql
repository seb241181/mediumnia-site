create table public.oracle_email_sequence_subscriptions (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  status text not null default 'pending',
  source text not null default 'oracle_free_result',
  consent_version text not null,
  sequence_version text not null,
  consented_at timestamptz not null default now(),
  unsubscribe_token_hash text not null,
  resend_email_ids text[] not null default '{}'::text[],
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oracle_email_sequence_email_hash_key unique (email_hash),
  constraint oracle_email_sequence_unsubscribe_token_hash_key unique (unsubscribe_token_hash),
  constraint oracle_email_sequence_email_hash_format_check
    check (email_hash ~ '^[0-9a-f]{64}$'),
  constraint oracle_email_sequence_token_hash_format_check
    check (unsubscribe_token_hash ~ '^[0-9a-f]{64}$'),
  constraint oracle_email_sequence_status_check
    check (status in ('pending', 'active', 'unsubscribed', 'failed')),
  constraint oracle_email_sequence_source_check
    check (source = 'oracle_free_result'),
  constraint oracle_email_sequence_resend_ids_count_check
    check (cardinality(resend_email_ids) <= 3),
  constraint oracle_email_sequence_unsubscribe_state_check
    check (
      (status = 'unsubscribed' and unsubscribed_at is not null)
      or (status <> 'unsubscribed' and unsubscribed_at is null)
    )
);

alter table public.oracle_email_sequence_subscriptions enable row level security;

revoke all on table public.oracle_email_sequence_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.oracle_email_sequence_subscriptions to service_role;

comment on table public.oracle_email_sequence_subscriptions is
  'Consent ledger for the finite three-email MediumIA sequence offered after the free Oracle draw. Raw email addresses are intentionally not stored.';
