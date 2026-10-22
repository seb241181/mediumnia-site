-- Agenda owner actions, local preparation only. Do not apply remotely without review.

CREATE TABLE IF NOT EXISTS public.rdv_booking_action_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation = 'reschedule'),
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,160}$'),
  previous_starts_at TIMESTAMPTZ NOT NULL,
  previous_ends_at TIMESTAMPTZ NOT NULL,
  next_starts_at TIMESTAMPTZ,
  next_ends_at TIMESTAMPTZ,
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 2048),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (actor_id, idempotency_key),
  CHECK (next_starts_at IS NOT NULL AND next_ends_at > next_starts_at)
);
CREATE INDEX IF NOT EXISTS rdv_booking_action_history_booking_idx
  ON public.rdv_booking_action_history (booking_id, created_at DESC);
ALTER TABLE public.rdv_booking_action_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rdv_booking_action_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_booking_action_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.rdv_booking_action_history TO service_role;

CREATE TABLE IF NOT EXISTS public.rdv_calendar_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  history_id UUID NOT NULL REFERENCES public.rdv_booking_action_history(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation = 'update_projection'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'retry', 'synced', 'superseded', 'review')),
  google_event_id TEXT NOT NULL CHECK (char_length(google_event_id) BETWEEN 1 AND 1024),
  previous_starts_at TIMESTAMPTZ NOT NULL,
  previous_ends_at TIMESTAMPTZ NOT NULL,
  target_starts_at TIMESTAMPTZ,
  target_ends_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,200}$'),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (operation = 'update_projection' AND target_starts_at IS NOT NULL AND target_ends_at > target_starts_at),
  CHECK ((status IN ('synced', 'superseded') AND completed_at IS NOT NULL)
      OR (status NOT IN ('synced', 'superseded') AND completed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS rdv_calendar_sync_jobs_due_idx
  ON public.rdv_calendar_sync_jobs (status, created_at)
  WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS rdv_calendar_sync_jobs_booking_idx
  ON public.rdv_calendar_sync_jobs (booking_id, created_at DESC);
ALTER TABLE public.rdv_calendar_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rdv_calendar_sync_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_calendar_sync_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.rdv_calendar_sync_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.rdv_admin_reschedule_booking(
  p_owner_id UUID,
  p_booking_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_booking public.bookings;
  v_service public.booking_services;
  v_practitioner public.booking_practitioners;
  v_exception public.booking_exceptions;
  v_balance public.rdv_balance_payments;
  v_hold public.rdv_booking_holds;
  v_paypal public.rdv_paypal_payments;
  v_history public.rdv_booking_action_history;
  v_google_job public.rdv_calendar_sync_jobs;
  v_local_start TIMESTAMP;
  v_local_end TIMESTAMP;
  v_local_date DATE;
  v_practitioner_id UUID;
  v_duration_seconds INTEGER;
  v_before INTEGER;
  v_after INTEGER;
  v_max INTEGER;
  v_min_advance INTEGER;
  v_horizon INTEGER;
  v_day_start TIMESTAMPTZ;
  v_day_end TIMESTAMPTZ;
  v_fits BOOLEAN := false;
  v_active_count INTEGER;
  v_result JSONB;
BEGIN
  PERFORM public.lumia_require_service_role();
  IF p_owner_id IS NULL OR p_booking_id IS NULL OR p_expected_updated_at IS NULL
     OR p_starts_at IS NULL OR p_ends_at IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9_.:-]{8,160}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  IF p_ends_at <= p_starts_at OR p_starts_at <= clock_timestamp()
     OR p_starts_at > clock_timestamp() + interval '370 days' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target_time');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('rdv-agenda:' || p_owner_id::text || ':' || p_idempotency_key));
  SELECT * INTO v_history FROM public.rdv_booking_action_history
  WHERE actor_id = p_owner_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_history.booking_id <> p_booking_id OR v_history.operation <> 'reschedule'
       OR v_history.next_starts_at IS DISTINCT FROM p_starts_at
       OR v_history.next_ends_at IS DISTINCT FROM p_ends_at THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
    END IF;
    RETURN v_history.result || jsonb_build_object('idempotent', true);
  END IF;

  -- Same lock namespace/order as checkout: serialize all slot changes per practitioner.
  SELECT practitioner_id INTO v_practitioner_id FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_practitioner_id::text));
  BEGIN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE NOWAIT;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
    -- A parallel request with the same key may have committed while this call
    -- waited for the practitioner advisory lock. Return its exact result.
    SELECT * INTO v_history FROM public.rdv_booking_action_history
      WHERE actor_id = p_owner_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_history.booking_id <> p_booking_id OR v_history.operation <> 'reschedule'
         OR v_history.next_starts_at IS DISTINCT FROM p_starts_at
         OR v_history.next_ends_at IS DISTINCT FROM p_ends_at THEN
        RETURN jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
      END IF;
      RETURN v_history.result || jsonb_build_object('idempotent', true);
    END IF;
    IF v_booking.status <> 'confirmed' OR v_booking.booking_source <> 'mediumia' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'booking_not_movable');
    END IF;
    IF v_booking.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RETURN jsonb_build_object('ok', false, 'error', 'booking_changed');
    END IF;
    IF v_booking.starts_at = p_starts_at AND v_booking.ends_at = p_ends_at THEN
      RETURN jsonb_build_object('ok', false, 'error', 'already_at_target');
    END IF;
    SELECT * INTO v_practitioner FROM public.booking_practitioners
      WHERE id = v_booking.practitioner_id AND owner_id = p_owner_id FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
    SELECT * INTO v_service FROM public.booking_services
      WHERE id = v_booking.service_id AND practitioner_id = v_booking.practitioner_id FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'service_not_found'); END IF;

    v_local_start := p_starts_at AT TIME ZONE 'Europe/Paris';
    v_local_end := p_ends_at AT TIME ZONE 'Europe/Paris';
    v_local_date := v_local_start::date;
    v_duration_seconds := v_service.duration_min * 60;
    IF p_ends_at <> p_starts_at + make_interval(mins => v_service.duration_min)
       OR v_local_end::date <> v_local_date THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_service_duration');
    END IF;

    SELECT * INTO v_exception FROM public.booking_exceptions
      WHERE practitioner_id = v_booking.practitioner_id AND exception_date = v_local_date;
    IF FOUND AND v_exception.exception_type = 'closed' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'exception_closed');
    ELSIF FOUND AND v_exception.exception_type = 'modified' THEN
      SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_exception.slots, '[]'::jsonb)) s
        WHERE (s->>'start_time') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
          AND (s->>'end_time') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
          AND v_local_start::time >= (s->>'start_time')::time
          AND v_local_end::time <= (s->>'end_time')::time
          AND mod(extract(epoch FROM (v_local_start::time - (s->>'start_time')::time))::integer, v_duration_seconds) = 0
      ) INTO v_fits;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.booking_availability_rules r
        WHERE r.practitioner_id = v_booking.practitioner_id
          AND r.day_of_week = extract(isodow FROM v_local_date)::integer - 1
          AND v_local_start::time >= r.start_time
          AND v_local_end::time <= r.end_time
          AND mod(extract(epoch FROM (v_local_start::time - r.start_time))::integer, v_duration_seconds) = 0
      ) INTO v_fits;
    END IF;
    IF NOT v_fits THEN RETURN jsonb_build_object('ok', false, 'error', 'outside_availability'); END IF;

    SELECT buffer_before_min, buffer_after_min, max_per_day, min_advance_hours, booking_horizon_days
      INTO v_before, v_after, v_max, v_min_advance, v_horizon
      FROM public.booking_practitioners WHERE id = v_booking.practitioner_id;
    IF p_starts_at < clock_timestamp() + make_interval(hours => COALESCE(v_min_advance, 0))
       OR p_starts_at > clock_timestamp() + make_interval(days => COALESCE(v_horizon, 370)) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'outside_booking_horizon');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.rdv_calendar_sync_jobs j
      WHERE j.booking_id = v_booking.id AND j.status IN ('pending', 'running', 'retry', 'review')
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'google_sync_pending');
    END IF;

    -- Keep payment rows stable while the appointment association and amount remain unchanged.
    BEGIN
      SELECT * INTO v_balance FROM public.rdv_balance_payments WHERE booking_id = v_booking.id FOR UPDATE NOWAIT;
      SELECT h.* INTO v_hold FROM public.rdv_booking_holds h WHERE h.converted_booking_id = v_booking.id FOR UPDATE NOWAIT;
      IF FOUND THEN
        SELECT * INTO v_paypal FROM public.rdv_paypal_payments WHERE hold_id = v_hold.id FOR UPDATE NOWAIT;
      END IF;
    EXCEPTION WHEN lock_not_available THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_busy');
    END;
    IF v_balance.id IS NOT NULL AND v_balance.status = 'capture_in_progress' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_busy');
    END IF;
    IF v_hold.id IS NOT NULL AND (v_paypal.id IS NULL OR v_paypal.status = 'capturing') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_busy');
    END IF;

    v_day_start := date_trunc('day', v_local_start) AT TIME ZONE 'Europe/Paris';
    v_day_end := (date_trunc('day', v_local_start) + interval '1 day') AT TIME ZONE 'Europe/Paris';
    IF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.practitioner_id = v_booking.practitioner_id AND b.id <> v_booking.id
        AND b.status = 'confirmed'
        AND (b.starts_at - make_interval(mins => COALESCE(v_before, 0))) < (p_ends_at + make_interval(mins => COALESCE(v_after, 0)))
        AND (b.ends_at + make_interval(mins => COALESCE(v_after, 0))) > (p_starts_at - make_interval(mins => COALESCE(v_before, 0)))
    ) OR EXISTS (
      SELECT 1 FROM public.rdv_booking_holds h
      WHERE h.practitioner_id = v_booking.practitioner_id
        AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > clock_timestamp()))
        AND (h.starts_at - make_interval(mins => COALESCE(v_before, 0))) < (p_ends_at + make_interval(mins => COALESCE(v_after, 0)))
        AND (h.ends_at + make_interval(mins => COALESCE(v_after, 0))) > (p_starts_at - make_interval(mins => COALESCE(v_before, 0)))
    ) OR EXISTS (
      SELECT 1 FROM public.booking_slot_offers o
      WHERE o.practitioner_id = v_booking.practitioner_id AND o.status = 'open'
        AND o.expires_at > clock_timestamp()
        AND (o.starts_at - make_interval(mins => COALESCE(v_before, 0))) < (p_ends_at + make_interval(mins => COALESCE(v_after, 0)))
        AND (o.ends_at + make_interval(mins => COALESCE(v_after, 0))) > (p_starts_at - make_interval(mins => COALESCE(v_before, 0)))
    ) THEN RETURN jsonb_build_object('ok', false, 'error', 'slot_unavailable'); END IF;

    IF v_max IS NOT NULL THEN
      SELECT count(*) INTO v_active_count FROM (
        SELECT id FROM public.bookings WHERE practitioner_id = v_booking.practitioner_id AND status = 'confirmed'
          AND id <> v_booking.id AND starts_at >= v_day_start AND starts_at < v_day_end
        UNION ALL
        SELECT id FROM public.rdv_booking_holds WHERE practitioner_id = v_booking.practitioner_id
          AND (status IN ('payment_capturing', 'payment_captured') OR (status = 'payment_pending' AND expires_at > clock_timestamp()))
          AND starts_at >= v_day_start AND starts_at < v_day_end
      ) active;
      IF v_active_count >= v_max THEN RETURN jsonb_build_object('ok', false, 'error', 'daily_limit_reached'); END IF;
    END IF;

    INSERT INTO public.rdv_booking_action_history (
      practitioner_id, booking_id, actor_id, operation, idempotency_key,
      previous_starts_at, previous_ends_at, next_starts_at, next_ends_at, result
    ) VALUES (
      v_booking.practitioner_id, v_booking.id, p_owner_id, 'reschedule', p_idempotency_key,
      v_booking.starts_at, v_booking.ends_at, p_starts_at, p_ends_at, '{}'::jsonb
    ) RETURNING * INTO v_history;
    UPDATE public.bookings SET starts_at = p_starts_at, ends_at = p_ends_at, updated_at = clock_timestamp()
      WHERE id = v_booking.id AND status = 'confirmed' AND updated_at = p_expected_updated_at;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'booking_changed'; END IF;
    v_result := jsonb_build_object('ok', true, 'booking_id', v_booking.id,
      'starts_at', p_starts_at, 'ends_at', p_ends_at, 'google_sync',
      CASE WHEN v_booking.google_event_id IS NULL THEN 'not_required' ELSE 'pending' END);
    UPDATE public.rdv_booking_action_history SET result = v_result WHERE id = v_history.id;
    IF v_booking.google_event_id IS NOT NULL THEN
      INSERT INTO public.rdv_calendar_sync_jobs (
        practitioner_id, booking_id, history_id, operation, google_event_id,
        previous_starts_at, previous_ends_at,
        target_starts_at, target_ends_at, idempotency_key
      ) VALUES (
        v_booking.practitioner_id, v_booking.id, v_history.id, 'update_projection', v_booking.google_event_id,
        v_booking.starts_at, v_booking.ends_at,
        p_starts_at, p_ends_at, 'rdv.google.update:' || v_history.id::text
      );
    END IF;
    RETURN v_result;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_busy');
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.rdv_admin_reschedule_booking(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_admin_reschedule_booking(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;
