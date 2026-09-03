-- MediumIA Rendez-vous — état de finalisation PayPal Sandbox.
-- Migration additive : ne modifie pas les règles de hold déjà validées.

ALTER TABLE public.rdv_paypal_payments
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_sync_status TEXT,
  ADD COLUMN IF NOT EXISTS google_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

ALTER TABLE public.rdv_paypal_payments
  ADD CONSTRAINT rdv_paypal_payments_google_sync_status_check
  CHECK (google_sync_status IS NULL OR google_sync_status IN ('pending', 'synced', 'already_synced', 'not_connected', 'failed'));

CREATE INDEX IF NOT EXISTS idx_rdv_paypal_payments_finalization
  ON public.rdv_paypal_payments (confirmation_sent_at, finalized_at)
  WHERE status = 'captured';
