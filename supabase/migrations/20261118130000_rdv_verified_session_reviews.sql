-- Explicit owner confirmation of consultation outcome.
-- Existing and upcoming bookings remain "pending": no automatic assumption that a past appointment happened.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS session_outcome text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS session_outcome_at timestamptz,
  ADD COLUMN IF NOT EXISTS session_outcome_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_session_outcome_check
  CHECK (session_outcome IN ('pending', 'completed', 'to_reschedule'));

CREATE INDEX IF NOT EXISTS bookings_review_verified_pending_idx
  ON public.bookings (ends_at)
  WHERE status = 'confirmed'
    AND session_outcome = 'completed'
    AND review_request_sent_at IS NULL;

-- Keep a separate, append-only audit trail; no payments or external calendars touched.
CREATE TABLE IF NOT EXISTS public.rdv_session_outcome_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  practitioner_id uuid NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  previous_outcome text NOT NULL,
  next_outcome text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS rdv_session_outcome_events_booking_idx
  ON public.rdv_session_outcome_events (booking_id, occurred_at DESC);
ALTER TABLE public.rdv_session_outcome_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_session_outcome_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.rdv_session_outcome_events TO service_role;

-- Moving the same paid booking makes it a NEW, unverified session.
-- The old review marker must not prevent a future review after genuine attendance.
CREATE OR REPLACE FUNCTION public.rdv_reset_session_on_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.starts_at IS DISTINCT FROM NEW.starts_at
     OR OLD.ends_at IS DISTINCT FROM NEW.ends_at THEN
    NEW.session_outcome := 'pending';
    NEW.session_outcome_at := NULL;
    NEW.session_outcome_by := NULL;
    NEW.review_request_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rdv_reset_session_on_move_trigger ON public.bookings;
CREATE TRIGGER rdv_reset_session_on_move_trigger
BEFORE UPDATE OF starts_at, ends_at ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.rdv_reset_session_on_move();
REVOKE ALL ON FUNCTION public.rdv_reset_session_on_move() FROM PUBLIC, anon, authenticated;

-- Only the authenticated owner's server can change outcome, through service_role.
-- The function never changes booking status, money, customer data or Google events.
CREATE OR REPLACE FUNCTION public.rdv_set_session_outcome(
  p_owner_id uuid,
  p_booking_id uuid,
  p_outcome text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  IF p_owner_id IS NULL OR p_booking_id IS NULL OR p_expected_updated_at IS NULL
     OR p_outcome IS NULL
     OR p_outcome NOT IN ('completed', 'to_reschedule', 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  SELECT b.* INTO v_booking
  FROM public.bookings b
  JOIN public.booking_practitioners p
    ON p.id = b.practitioner_id AND p.owner_id = p_owner_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  IF v_booking.status <> 'confirmed' OR v_booking.booking_source <> 'mediumia' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_markable');
  END IF;
  IF v_booking.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_changed');
  END IF;
  IF p_outcome = 'completed' AND v_booking.ends_at > clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'appointment_not_finished');
  END IF;
  IF p_outcome = 'completed' AND v_booking.session_outcome = 'to_reschedule' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'move_required');
  END IF;
  IF v_booking.session_outcome = p_outcome THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'outcome', p_outcome);
  END IF;

  UPDATE public.bookings SET
    session_outcome = p_outcome,
    session_outcome_at = clock_timestamp(),
    session_outcome_by = p_owner_id
  WHERE id = p_booking_id;

  INSERT INTO public.rdv_session_outcome_events
    (booking_id, practitioner_id, actor_id, previous_outcome, next_outcome)
  VALUES (v_booking.id, v_booking.practitioner_id, p_owner_id,
          v_booking.session_outcome, p_outcome);

  RETURN jsonb_build_object('ok', true, 'already', false, 'outcome', p_outcome);
EXCEPTION WHEN lock_not_available THEN
  RETURN jsonb_build_object('ok', false, 'error', 'booking_busy');
END;
$$;
REVOKE ALL ON FUNCTION public.rdv_set_session_outcome(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_set_session_outcome(uuid, uuid, text, timestamptz)
  TO service_role;
