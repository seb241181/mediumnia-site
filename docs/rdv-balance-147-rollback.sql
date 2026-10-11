-- Retour arrière de 20261011160000_rdv_balance_owner_review_restore.sql (#147)
-- À n'exécuter que sur décision explicite, dans l'éditeur SQL, une étape à la fois.
--
-- Niveau 1 — interrupteur immédiat, sans redéploiement : revient au
-- comportement d'annulation d'avant (plus d'exigence d'alerte préalable).
-- Les garde-fous « Maintenir », lien tardif, paiement engagé ou externe restent actifs.
--   UPDATE public.rdv_balance_runtime_settings
--   SET require_owner_alert = false, auto_cancel_mode = 'auto'
--   WHERE singleton = true;
--
-- Niveau 2 — fonctions d'avant (définitions PROD relevées le 11/10/2026),
-- puis suppression des nouvelles fonctions. Les colonnes et tables ajoutées
-- sont conservées (journal d'audit, sans effet sur l'ancien code).
-- Prérequis : redéployer d'abord le code de main (sans le panneau ni l'action
-- « balance-watch »), sinon l'interface appelle des fonctions absentes.

CREATE OR REPLACE FUNCTION public.claim_rdv_balance_auto_cancel(p_booking_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking public.bookings;
  v_service public.booking_services;
  v_payment public.rdv_balance_payments;
  v_paid INTEGER;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = v_booking.service_id;
  IF NOT FOUND OR NOT ('video' = ANY(v_service.modality)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_video_only');
  END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  IF v_booking.status <> 'confirmed'
     OR v_booking.booking_source <> 'mediumia'
     OR v_booking.starts_at <= p_now
     OR v_booking.starts_at > p_now + INTERVAL '48 hours'
     OR COALESCE(v_booking.booked_price_cents, 0) <= v_paid
     OR v_booking.balance_paid_at IS NOT NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_due_for_balance_cancel');
  END IF;

  SELECT * INTO v_payment FROM public.rdv_balance_payments WHERE booking_id = v_booking.id FOR UPDATE;
  IF FOUND AND v_payment.status IN ('captured', 'capture_in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_in_progress');
  END IF;

  IF v_booking.balance_cancel_claimed_at IS NOT NULL
     AND v_booking.balance_cancel_claimed_at > p_now - INTERVAL '15 minutes'
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_cancel_in_progress');
  END IF;

  UPDATE public.bookings
  SET balance_cancel_claimed_at = p_now, updated_at = now()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_rdv_balance_auto_cancel(p_booking_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking public.bookings;
  v_paid INTEGER;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  IF v_booking.status <> 'confirmed'
     OR v_booking.balance_cancel_claimed_at IS NULL
     OR v_booking.starts_at > p_now + INTERVAL '48 hours'
     OR COALESCE(v_booking.booked_price_cents, 0) <= v_paid
     OR v_booking.balance_paid_at IS NOT NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_no_longer_due_for_balance_cancel');
  END IF;

  UPDATE public.bookings
  SET status = 'cancelled', cancelled_at = p_now,
      cancel_reason = 'balance_unpaid_48h',
      balance_auto_cancelled_at = p_now,
      balance_cancel_claimed_at = NULL,
      balance_payment_token_hash = NULL,
      balance_payment_token_expires_at = NULL,
      updated_at = now()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking.id);
END;
$function$;

-- create_or_get_rdv_balance_payment et claim_rdv_balance_capture : seule la
-- borne horaire avait changé. Retour à la borne H-48 seule :
--   remplacer  now() >= COALESCE(v_booking.balance_late_payment_until, v_booking.starts_at - INTERVAL '48 hours')
--   par        now() >= v_booking.starts_at - INTERVAL '48 hours'
-- dans les définitions de supabase/migrations/20260917114500_rdv_balance_reminders_and_payment.sql
-- (empreintes PROD d'avant : create_or_get b0af5fdf…, claim_capture 5659f5e2…).
-- Attention : une visio rétablie dont le lien tardif est en cours ne pourrait
-- alors plus être réglée ; vérifier qu'aucune n'est en cours avant ce retour.

DROP FUNCTION IF EXISTS public.rdv_balance_watch(UUID, TIMESTAMPTZ, INTEGER);
DROP FUNCTION IF EXISTS public.rotate_rdv_balance_restore_token(UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.record_rdv_balance_restore_email(UUID, TEXT);
DROP FUNCTION IF EXISTS public.compensate_rdv_balance_restore(UUID, TEXT);
DROP FUNCTION IF EXISTS public.complete_rdv_balance_restore(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.restore_rdv_balance_cancelled_booking(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.rdv_balance_restore_blocker(UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.set_rdv_balance_owner_decision(UUID, UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.finalize_rdv_balance_owner_alert(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.claim_rdv_balance_owner_alert(UUID, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.rdv_balance_cancel_blocker(UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.rdv_balance_external_payment_cents(UUID);
