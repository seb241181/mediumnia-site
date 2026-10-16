-- Historical PayPal Live order reconciliation completed on 2026-10-16:
-- 2 retained charges and 3 previously refunded duplicates reconciled.
-- Remove the exceptional server-only entry point permanently.
-- This migration never reads or mutates orders, never calls PayPal,
-- and never triggers email notifications.
REVOKE ALL ON FUNCTION public.finalize_email_question_history_20261016(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_email_question_history_20261016(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_email_question_history_20261016(jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.finalize_email_question_history_20261016(jsonb) FROM service_role;
DROP FUNCTION IF EXISTS public.finalize_email_question_history_20261016(jsonb);
