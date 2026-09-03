-- Delivery metadata for completed CHRONOSPHERE 999 draws.
-- Email addresses are never stored in clear text; all access remains service_role-only.

alter table chronosphere_paid_draws
  add column if not exists delivery_email_hash text,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_delivery_failure_code text;

-- The table already has RLS enabled and no public policies. This migration adds
-- metadata only and does not grant any new access to anon or authenticated roles.
