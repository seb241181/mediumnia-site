-- Safety follow-up for owner_booking_cancel_claim_test (TEST first).
-- bookings has table-level UPDATE grants to anon/authenticated. Row-level
-- ownership policy is not a substitute for protecting the new lock fields.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

CREATE OR REPLACE FUNCTION public.guard_owner_cancel_claim_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- SEC INVOKER: current_user reflects the caller's PostgreSQL role. The
  -- service-role RPCs run as their SECURITY DEFINER owner (postgres).
  IF CURRENT_USER NOT IN ('postgres', 'service_role') AND (
    NEW.owner_cancel_claim_id IS DISTINCT FROM OLD.owner_cancel_claim_id
    OR NEW.owner_cancel_claimed_at IS DISTINCT FROM OLD.owner_cancel_claimed_at
    OR (
      OLD.owner_cancel_claim_id IS NOT NULL
      AND OLD.status = 'confirmed'
      AND NEW.status IS DISTINCT FROM OLD.status
    )
  ) THEN
    RAISE EXCEPTION 'owner_cancel_claim_fields_protected'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_owner_cancel_claim_fields ON public.bookings;
CREATE TRIGGER guard_owner_cancel_claim_fields
  BEFORE UPDATE OF owner_cancel_claim_id, owner_cancel_claimed_at, status
  ON public.bookings FOR EACH ROW
  EXECUTE FUNCTION public.guard_owner_cancel_claim_fields();

REVOKE ALL ON FUNCTION public.guard_owner_cancel_claim_fields()
  FROM PUBLIC, anon, authenticated;
