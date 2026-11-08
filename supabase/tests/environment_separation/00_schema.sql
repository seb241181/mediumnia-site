-- Schéma minimal (colonnes utiles à la garde) pour tester 20261108130000 sur
-- une base locale jetable. Ne pas appliquer ailleurs.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.booking_services (id uuid PRIMARY KEY);
CREATE TABLE public.bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['rdv_paypal_payments','rdv_balance_payments','rdv_payment_refunds','rdv_deposit_transfers',
    'mediumia_paypal_purchases','mediumia_paypal_order_intents','mediumia_paypal_plans','mediumia_formation_payments',
    'mediumia_formation_subscriptions','mediumia_formation_unlock_orders','mediumia_email_questions','gift_cards',
    'conference_passes','chronosphere_credit_packs'] LOOP
    EXECUTE format('CREATE TABLE public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), paypal_env text NOT NULL, status text)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO service_role', t);
  END LOOP;
END $$;
CREATE TABLE public.mediumia_entitlements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), origin_ref text, status text);
GRANT SELECT, INSERT, UPDATE ON public.mediumia_entitlements, public.booking_services, public.bookings TO service_role;
