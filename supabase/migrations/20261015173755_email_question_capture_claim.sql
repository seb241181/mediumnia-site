-- Durable capture claim. NULL permits one atomic conditional UPDATE before POST.
-- Never clear/expire this marker automatically: uncertainty is reconciled by GET.
-- Additive only; no historical financial rows are rewritten.
ALTER TABLE public.mediumia_email_questions
  ADD COLUMN IF NOT EXISTS capture_started_at TIMESTAMPTZ;

COMMENT ON COLUMN public.mediumia_email_questions.capture_started_at IS
  'Durable capture attempt marker; never reset automatically after an uncertain PayPal response.';
