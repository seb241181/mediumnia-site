-- Lumia Phase 3B — annulation MediumIA préparée mais dormante.
--
-- Ce fichier ne sera appliqué qu'après revue explicite. Il ne contacte ni
-- Google, ni e-mail, ni Messages. LUMIA_ALLOWED_ACTIONS reste [] dans le code.
-- L'unique écriture future de l'exécuteur est la transition métier atomique
-- confirmed -> cancelled, plus le journal Lumia et un éventuel job Google.

CREATE TABLE IF NOT EXISTS public.lumia_calendar_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  practitioner_id UUID NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('cancel_projection')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'retry', 'done', 'manual_review')),
  google_event_id TEXT NOT NULL CHECK (char_length(google_event_id) BETWEEN 1 AND 1024),
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,200}$'),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 120),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lumia_calendar_sync_jobs_booking_operation_unique UNIQUE (booking_id, operation),
  CONSTRAINT lumia_calendar_sync_jobs_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT lumia_calendar_sync_jobs_completion_check CHECK (
    (status = 'done' AND completed_at IS NOT NULL)
    OR (status <> 'done' AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS lumia_calendar_sync_jobs_pending_idx
  ON public.lumia_calendar_sync_jobs (status, created_at)
  WHERE status IN ('pending', 'retry', 'manual_review');
CREATE INDEX IF NOT EXISTS lumia_calendar_sync_jobs_practitioner_idx
  ON public.lumia_calendar_sync_jobs (practitioner_id, created_at DESC);

ALTER TABLE public.lumia_calendar_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lumia_calendar_sync_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lumia_calendar_sync_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lumia_calendar_sync_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.lumia_execute_mediumia_booking_cancel(
  p_owner_id UUID,
  p_conversation_id UUID,
  p_intent_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intent public.lumia_action_intents;
  v_booking public.bookings;
  v_balance public.rdv_balance_payments;
  v_paypal public.rdv_paypal_payments;
  v_hold public.rdv_booking_holds;
  v_google_job public.lumia_calendar_sync_jobs;
  v_has_gift BOOLEAN := false;
  v_has_refund BOOLEAN := false;
  v_has_transfer BOOLEAN := false;
  v_booking_found BOOLEAN := false;
  v_google_job_found BOOLEAN := false;
  v_failure TEXT;
  v_result JSONB;
BEGIN
  PERFORM public.lumia_require_service_role();

  IF p_owner_id IS NULL OR p_conversation_id IS NULL OR p_intent_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_owner_conversation_intent_required';
  END IF;

  SELECT * INTO v_intent
  FROM public.lumia_action_intents
  WHERE id = p_intent_id
    AND owner_id = p_owner_id
    AND conversation_id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'lumia_intent_not_owned';
  END IF;

  -- A network crash after a committed execution returns the exact terminal
  -- result. A retry of an executing intent continues below; it is not stuck.
  IF v_intent.status IN ('succeeded', 'failed', 'compensation_required') THEN
    RETURN COALESCE(v_intent.execution_result, jsonb_build_object(
      'intent_id', v_intent.id, 'status', v_intent.status, 'idempotent', true
    ));
  END IF;

  IF v_intent.status <> 'executing' THEN
    RETURN jsonb_build_object(
      'intent_id', v_intent.id, 'status', v_intent.status,
      'executed', false, 'reason', 'intent_not_claimed'
    );
  END IF;

  -- All failures below are intentional business refusals. They are committed
  -- with their audit row and returned; do not RAISE after this point.
  IF v_intent.action_type <> 'mediumia.booking.cancel'
     OR v_intent.target_source <> 'mediumia_booking'
     OR v_intent.target_id IS NULL
     OR v_intent.target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_intent.practitioner_id IS NULL
  THEN
    v_failure := 'intent_target_incoherent';
  ELSIF v_intent.preview_expires_at <= clock_timestamp() THEN
    v_failure := 'preview_expired';
  END IF;

  IF v_failure IS NULL THEN
    -- First lock the target itself. Every subsequent financial lock is NOWAIT:
    -- legacy flows do not all use the same order, so Lumia must never wait
    -- while holding a booking or payment lock.
    BEGIN
      SELECT * INTO v_booking
      FROM public.bookings
      WHERE id = v_intent.target_id::UUID
      FOR UPDATE NOWAIT;
      v_booking_found := FOUND;
    EXCEPTION WHEN lock_not_available THEN
      v_failure := 'booking_or_payment_busy';
    END;

    IF v_failure IS NULL THEN
      IF NOT v_booking_found THEN
        v_failure := 'booking_not_found';
      ELSIF v_booking.practitioner_id <> v_intent.practitioner_id THEN
        v_failure := 'booking_practitioner_mismatch';
      ELSE
        PERFORM 1
        FROM public.booking_practitioners p
        WHERE p.id = v_booking.practitioner_id
          AND p.owner_id = p_owner_id;
        IF NOT FOUND THEN
          v_failure := 'practitioner_not_owned';
        END IF;
      END IF;
      IF v_failure IS NULL AND v_booking.booking_source IS DISTINCT FROM 'mediumia' THEN
        v_failure := 'lumia_booking_source_not_allowed';
      ELSIF v_failure IS NULL AND v_booking.status <> 'confirmed' THEN
        v_failure := 'booking_not_confirmed';
      ELSIF v_failure IS NULL AND (v_intent.expected_target_updated_at IS NULL
         OR v_booking.updated_at IS DISTINCT FROM v_intent.expected_target_updated_at) THEN
        v_failure := 'booking_changed_since_preview';
      END IF;
    END IF;
  END IF;

  IF v_failure IS NULL THEN
    -- Deterministic financial lock order after bookings:
    -- balance payment → booking hold → PayPal payment → refunds → transfers
    -- → gift redemptions. Every participating state is locked NOWAIT.
    BEGIN
      SELECT * INTO v_balance
      FROM public.rdv_balance_payments
      WHERE booking_id = v_booking.id
      FOR UPDATE NOWAIT;

      SELECT h.* INTO v_hold
      FROM public.rdv_booking_holds h
      WHERE h.converted_booking_id = v_booking.id
      FOR UPDATE NOWAIT;
      IF FOUND THEN
        SELECT * INTO v_paypal
        FROM public.rdv_paypal_payments
        WHERE hold_id = v_hold.id
        FOR UPDATE NOWAIT;
      END IF;

      PERFORM 1 FROM public.rdv_payment_refunds r
        WHERE r.booking_id = v_booking.id
        ORDER BY r.id FOR UPDATE NOWAIT;
      v_has_refund := FOUND;
      PERFORM 1 FROM public.rdv_deposit_transfers t
        WHERE t.source_booking_id = v_booking.id OR t.target_booking_id = v_booking.id
        ORDER BY t.id FOR UPDATE NOWAIT;
      v_has_transfer := FOUND;
      -- The schema does not make redemptions immutable. Lock every existing
      -- use even though the normal booking flow never adds one post-confirm.
      PERFORM 1 FROM public.gift_card_redemptions g
        WHERE g.booking_id = v_booking.id
        ORDER BY g.id FOR UPDATE NOWAIT;
      v_has_gift := FOUND;
    EXCEPTION WHEN lock_not_available THEN
      v_failure := 'booking_or_payment_busy';
    END;

    IF v_failure IS NULL AND v_balance.id IS NOT NULL
       AND v_balance.status NOT IN ('order_pending', 'failed') THEN
      v_failure := CASE v_balance.status
        WHEN 'capture_in_progress' THEN 'balance_capture_in_progress'
        WHEN 'captured' THEN 'balance_already_captured_requires_settlement'
        ELSE 'balance_payment_state_blocked'
      END;
    ELSIF v_failure IS NULL AND v_hold.id IS NOT NULL
       AND (v_paypal.id IS NULL OR v_paypal.status <> 'captured') THEN
      v_failure := 'deposit_payment_not_stable';
    ELSIF v_failure IS NULL AND v_paypal.id IS NOT NULL
       AND v_paypal.settlement_status NOT IN ('open', 'retained') THEN
      v_failure := 'deposit_settlement_state_blocked';
    END IF;

    IF v_failure IS NULL THEN
      IF v_has_gift THEN v_failure := 'gift_card_redemption_blocked';
      ELSIF v_has_refund THEN v_failure := 'refund_exists_requires_review';
      ELSIF v_has_transfer THEN v_failure := 'deposit_transfer_exists_requires_review';
      END IF;
  END IF;

  -- The Google projection must already be safely representable before the
  -- business source of truth is changed. Lock any existing job *before* the
  -- booking update; a done/manual/different-event job is a durable refusal.
  IF v_failure IS NULL AND v_booking.google_event_id IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_google_job
      FROM public.lumia_calendar_sync_jobs
      WHERE booking_id = v_booking.id AND operation = 'cancel_projection'
      FOR UPDATE NOWAIT;
      v_google_job_found := FOUND;
    EXCEPTION WHEN lock_not_available THEN
      v_failure := 'booking_or_payment_busy';
    END;
    IF v_failure IS NULL AND v_google_job_found
       AND (v_google_job.google_event_id <> v_booking.google_event_id
         OR v_google_job.status NOT IN ('pending', 'retry', 'running')) THEN
      v_failure := 'google_sync_job_incoherent';
    END IF;
  END IF;

  -- Only after every guard (including the job guard) may the booking change.
  -- The insert lives in the same subtransaction as this update. If another
  -- transaction inserts the unique job first, unique_violation rolls this
  -- update back before we reread and validate the winner.
  IF v_failure IS NULL THEN
    BEGIN
      UPDATE public.bookings
      SET status = 'cancelled', cancelled_at = clock_timestamp(),
          cancel_reason = 'lumia_owner_confirmed', updated_at = clock_timestamp()
      WHERE id = v_booking.id
        AND status = 'confirmed'
        AND updated_at = v_intent.expected_target_updated_at;
      IF NOT FOUND THEN
        v_failure := 'booking_changed_since_preview';
      ELSIF v_booking.google_event_id IS NOT NULL AND NOT v_google_job_found THEN
        INSERT INTO public.lumia_calendar_sync_jobs(
          booking_id, practitioner_id, operation, status, google_event_id, idempotency_key
        ) VALUES (
          v_booking.id, v_booking.practitioner_id, 'cancel_projection', 'pending',
          v_booking.google_event_id, 'lumia.google.cancel_projection:' || v_booking.id::TEXT
        )
        RETURNING * INTO v_google_job;
        v_google_job_found := true;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- The subtransaction rollback leaves the booking confirmed. A concurrent
      -- creator is acceptable only if its job is for this same event and still
      -- needs sync. Otherwise the common durable failure path below is used.
      v_google_job_found := false;
      BEGIN
        SELECT * INTO v_google_job
        FROM public.lumia_calendar_sync_jobs
        WHERE booking_id = v_booking.id AND operation = 'cancel_projection'
        FOR UPDATE NOWAIT;
        v_google_job_found := FOUND;
      EXCEPTION WHEN lock_not_available THEN
        v_failure := 'booking_or_payment_busy';
      END;
      IF v_failure IS NULL AND (NOT v_google_job_found
          OR v_google_job.google_event_id <> v_booking.google_event_id
          OR v_google_job.status NOT IN ('pending', 'retry', 'running')) THEN
        v_failure := 'google_sync_job_incoherent';
      END IF;
      IF v_failure IS NULL THEN
        UPDATE public.bookings
        SET status = 'cancelled', cancelled_at = clock_timestamp(),
            cancel_reason = 'lumia_owner_confirmed', updated_at = clock_timestamp()
        WHERE id = v_booking.id
          AND status = 'confirmed'
          AND updated_at = v_intent.expected_target_updated_at;
        IF NOT FOUND THEN
          v_failure := 'booking_changed_since_preview';
        END IF;
      END IF;
    END;
  END IF;

  -- All intentional business failures pass through this single durable path.
  -- No exception is raised after the intent state and audit have been written.
  IF v_failure IS NOT NULL THEN
    v_result := jsonb_build_object(
      'intent_id', v_intent.id, 'status', 'failed', 'executed', false,
      'reason', v_failure
    );
    UPDATE public.lumia_action_intents
    SET status = 'failed', executed_at = clock_timestamp(),
        execution_result = v_result, updated_at = clock_timestamp()
    WHERE id = v_intent.id;
    INSERT INTO public.lumia_action_attempts(intent_id, owner_id, event_type, actor_type, actor_id, detail)
    VALUES (v_intent.id, p_owner_id, 'finished', 'executor', p_owner_id,
      jsonb_build_object('status', 'failed', 'reason', v_failure));
    RETURN v_result;
  END IF;

  v_result := jsonb_build_object(
    'intent_id', v_intent.id, 'status', 'succeeded', 'executed', true,
    'booking_id', v_booking.id,
    'google_sync', CASE WHEN v_booking.google_event_id IS NULL THEN 'not_required' ELSE COALESCE(v_google_job.status, 'pending') END
  );
  UPDATE public.lumia_action_intents
  SET status = 'succeeded', executed_at = clock_timestamp(),
      execution_result = v_result, updated_at = clock_timestamp()
  WHERE id = v_intent.id;
  INSERT INTO public.lumia_action_attempts(intent_id, owner_id, event_type, actor_type, actor_id, detail)
  VALUES (v_intent.id, p_owner_id, 'finished', 'executor', p_owner_id,
    jsonb_build_object('status', 'succeeded', 'booking_id', v_booking.id,
      'google_sync', CASE WHEN v_booking.google_event_id IS NULL THEN 'not_required' ELSE COALESCE(v_google_job.status, 'pending') END));
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.lumia_execute_mediumia_booking_cancel(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lumia_execute_mediumia_booking_cancel(UUID, UUID, UUID) TO service_role;
