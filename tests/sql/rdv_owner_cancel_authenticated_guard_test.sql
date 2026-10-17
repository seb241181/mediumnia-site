-- PR #158: trigger authorization check on Supabase TEST ONLY.
-- NEVER use in Production. The temporary fixture-scoped RLS policy and
-- synthetic booking are both reverted by ROLLBACK.
-- This tests the trigger independently of the original owner RLS policy.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

INSERT INTO public.bookings (
  id, practitioner_id, service_id, customer_first_name, customer_last_name,
  customer_email, starts_at, ends_at, booking_source,
  booked_price_cents, reservation_payment_cents, status
)
SELECT 'd9381607-d011-4dc2-8329-989ddf210048'::uuid, p.id, s.id,
       'TEST AUTH TRIGGER', 'ROLLBACK', 'test-auth-trigger@example.invalid',
       '2099-05-28T10:00:00Z'::timestamptz, '2099-05-28T11:00:00Z'::timestamptz,
       'mediumia', s.price_cents, s.reservation_payment_cents, 'confirmed'
FROM public.booking_services s
JOIN public.booking_practitioners p ON p.id=s.practitioner_id
WHERE s.booking_mode='instant'
  AND s.reservation_payment_kind='none'
  AND p.owner_id IS NOT NULL
ORDER BY s.id LIMIT 1;

-- This policy is *uncommitted*, visible only in this test transaction, and
-- restricts access to a synthetic UUID. It cannot change persistent RLS.
CREATE POLICY owner_cancel_fixture_only_rollback_20261016
  ON public.bookings FOR ALL TO authenticated
  USING (id='d9381607-d011-4dc2-8329-989ddf210048'::uuid)
  WITH CHECK (id='d9381607-d011-4dc2-8329-989ddf210048'::uuid);

SET LOCAL ROLE authenticated;
DO $guard_test$
DECLARE
  v_count integer;
  v_blocked boolean := false;
BEGIN
  SELECT count(*) INTO v_count FROM public.bookings
    WHERE id='d9381607-d011-4dc2-8329-989ddf210048'::uuid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'fixture_not_visible_even_with_temp_policy';
  END IF;
  BEGIN
    UPDATE public.bookings
    SET owner_cancel_claim_id='d9381607-d011-4dc2-8329-989ddf210049'::uuid,
        owner_cancel_claimed_at=clock_timestamp()
    WHERE id='d9381607-d011-4dc2-8329-989ddf210048'::uuid;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'authenticated_claim_mutation_was_not_rejected';
  END IF;
END $guard_test$;
RESET ROLE;
ROLLBACK;
