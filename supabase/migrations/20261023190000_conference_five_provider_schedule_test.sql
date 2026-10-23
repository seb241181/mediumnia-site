-- TEST only: use PayPal's authoritative subscription billing schedule.
-- Do not apply in Production; offer is not approved for real sales.
ALTER TABLE public.conference_five_contracts
  ADD COLUMN IF NOT EXISTS paypal_billing_anchor_at timestamptz,
  ADD COLUMN IF NOT EXISTS paypal_next_billing_at timestamptz,
  ADD COLUMN IF NOT EXISTS paypal_regular_cycles_completed smallint;
ALTER TABLE public.conference_five_contracts
  ADD CONSTRAINT conference_five_cycles_range
  CHECK (paypal_regular_cycles_completed IS NULL OR paypal_regular_cycles_completed BETWEEN 0 AND 5);
ALTER TABLE public.conference_five_contracts
  ADD CONSTRAINT conference_five_provider_next_after_start
  CHECK (paypal_next_billing_at IS NULL OR paypal_billing_anchor_at IS NULL OR paypal_next_billing_at >= paypal_billing_anchor_at);
COMMENT ON COLUMN public.conference_five_contracts.paypal_billing_anchor_at IS
  'PayPal subscription.start_time only, never inferred from first capture date. Required for provisional meeting rights.';
COMMENT ON COLUMN public.conference_five_contracts.paypal_next_billing_at IS
  'Last PayPal billing_info.next_billing_time. NULL after final cycle.';
COMMENT ON COLUMN public.conference_five_contracts.paypal_regular_cycles_completed IS
  'PayPal billing_info.cycle_executions REGULAR completed cycles; null until checked.';
