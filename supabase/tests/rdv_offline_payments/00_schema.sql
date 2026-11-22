-- Schéma minimal fidèle à la Production (colonnes, contraintes, déclencheurs
-- relus le 08/11/2026) pour tester 20261108120000_rdv_offline_payments.sql.
-- Base locale jetable uniquement. Ne pas appliquer ailleurs.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE TABLE public.booking_practitioners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  owner_id uuid, slug text NOT NULL UNIQUE, name text NOT NULL, role text NOT NULL DEFAULT '', photo_url text, tagline text NOT NULL DEFAULT '',
  intro text NOT NULL DEFAULT '', timezone text NOT NULL DEFAULT 'Europe/Paris', is_active boolean NOT NULL DEFAULT false,
  booking_horizon_days integer NOT NULL DEFAULT 60, buffer_before_min integer NOT NULL DEFAULT 0, buffer_after_min integer NOT NULL DEFAULT 15,
  min_advance_hours integer NOT NULL DEFAULT 24, max_per_day integer, booking_enabled boolean NOT NULL DEFAULT false);

CREATE TABLE public.booking_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  practitioner_id uuid NOT NULL REFERENCES public.booking_practitioners(id), slug text NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '',
  duration_min integer NOT NULL, price_cents integer, currency text NOT NULL DEFAULT 'EUR', modality text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, booking_mode text NOT NULL DEFAULT 'instant',
  reservation_payment_kind text NOT NULL DEFAULT 'none', reservation_payment_cents integer NOT NULL DEFAULT 0, vat_rate_bps integer NOT NULL DEFAULT 2000);

CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  practitioner_id uuid NOT NULL REFERENCES public.booking_practitioners(id), service_id uuid NOT NULL REFERENCES public.booking_services(id),
  customer_first_name text NOT NULL, customer_last_name text NOT NULL, customer_email text NOT NULL, customer_phone text, customer_message text,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, timezone text NOT NULL DEFAULT 'Europe/Paris',
  status text NOT NULL DEFAULT 'confirmed' CHECK (status = ANY (ARRAY['confirmed','cancelled','rescheduled','no_show'])),
  cancelled_at timestamptz, cancel_reason text, google_event_id text, google_meet_link text,
  cancellation_token_hash text CHECK (cancellation_token_hash IS NULL OR cancellation_token_hash ~ '^[0-9a-f]{64}$'), cancellation_token_created_at timestamptz,
  booked_price_cents integer CHECK (booked_price_cents IS NULL OR booked_price_cents > 0),
  reservation_payment_cents integer CHECK (reservation_payment_cents IS NULL OR reservation_payment_cents >= 0),
  booking_source text NOT NULL DEFAULT 'mediumia' CHECK (booking_source = ANY (ARRAY['mediumia','reservio','manual'])),
  balance_payment_token_hash text, balance_payment_token_expires_at timestamptz, balance_reminder_sent_at timestamptz, balance_reminder_email_id text,
  balance_paid_at timestamptz, balance_cancel_claimed_at timestamptz, balance_auto_cancelled_at timestamptz, balance_reminder_claimed_at timestamptz,
  review_request_sent_at timestamptz, appointment_reminder_sent_at timestamptz, appointment_sms_reminder_sent_at timestamptz,
  balance_owner_decision text CHECK (balance_owner_decision IS NULL OR balance_owner_decision = ANY (ARRAY['hold','cancel'])),
  balance_owner_decision_at timestamptz, balance_owner_decision_by uuid, balance_owner_decision_note text, balance_review_reason text,
  balance_review_flagged_at timestamptz, balance_late_payment_until timestamptz, balance_restored_at timestamptz,
  balance_google_resync_at timestamptz, balance_google_resync_claimed_at timestamptz, balance_google_resync_error text, balance_google_resync_review_at timestamptz,
  CHECK (ends_at > starts_at),
  CONSTRAINT bookings_balance_late_payment_before_start_check CHECK (balance_late_payment_until IS NULL OR balance_late_payment_until < starts_at));

CREATE TABLE public.rdv_financial_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practitioner_id uuid NOT NULL, booking_id uuid, service_id uuid,
  source text NOT NULL CHECK (source = ANY (ARRAY['mediumia','reservio','manual'])),
  entry_kind text NOT NULL CHECK (entry_kind = ANY (ARRAY['arrhes','balance','full_payment','refund','arrhes_retained','adjustment','gift_card_sale','deposit_transfer'])),
  direction text NOT NULL CHECK (direction = ANY (ARRAY['income','refund'])),
  payment_method text NOT NULL CHECK (payment_method = ANY (ARRAY['paypal','card','cash','check','transfer','other','gift_card'])),
  occurred_at timestamptz NOT NULL DEFAULT now(), gross_cents integer NOT NULL CHECK (gross_cents > 0), net_cents integer NOT NULL CHECK (net_cents >= 0),
  vat_cents integer NOT NULL CHECK (vat_cents >= 0), vat_rate_bps integer NOT NULL CHECK (vat_rate_bps >= 0 AND vat_rate_bps <= 10000),
  vat_status text NOT NULL DEFAULT 'taxable' CHECK (vat_status = ANY (ARRAY['taxable','outside_scope','review'])),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'), service_price_cents integer CHECK (service_price_cents IS NULL OR service_price_cents > 0),
  appointment_starts_at timestamptz, customer_name text, customer_email text, external_booking_ref text, external_payment_ref text, note text,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (net_cents + vat_cents = gross_cents));
CREATE UNIQUE INDEX uq_rdv_financial_entries_external_payment_ref ON public.rdv_financial_entries (source, external_payment_ref) WHERE external_payment_ref IS NOT NULL;

CREATE TABLE public.rdv_balance_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL UNIQUE, client_checkout_id uuid NOT NULL,
  paypal_order_id text UNIQUE, paypal_capture_id text UNIQUE, paypal_env text NOT NULL CHECK (paypal_env = ANY (ARRAY['sandbox','live'])),
  amount_cents integer NOT NULL CHECK (amount_cents > 0), currency text NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  status text NOT NULL DEFAULT 'order_pending' CHECK (status = ANY (ARRAY['order_pending','capture_in_progress','captured','failed'])),
  capture_claimed_at timestamptz, captured_at timestamptz, last_error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.rdv_balance_runtime_settings (singleton boolean NOT NULL DEFAULT true PRIMARY KEY, sweep_url text, updated_at timestamptz NOT NULL DEFAULT now(),
  auto_cancel_mode text NOT NULL DEFAULT 'auto', require_owner_alert boolean NOT NULL DEFAULT true, owner_alert_min_lead_hours integer NOT NULL DEFAULT 6);
CREATE TABLE public.rdv_balance_restorations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL, idempotency_key uuid NOT NULL,
  status text NOT NULL DEFAULT 'google_pending', previous jsonb NOT NULL, late_until timestamptz NOT NULL, due_cents integer NOT NULL, google_status text,
  email_status text, actor uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  resume_claimed_at timestamptz, attempts integer NOT NULL DEFAULT 0, last_error text, google_event_id text);
CREATE TABLE public.rdv_balance_owner_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL, kind text NOT NULL,
  status text NOT NULL DEFAULT 'claimed', reason text, claimed_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, email_id text, updated_at timestamptz NOT NULL DEFAULT now());

-- Déclencheurs de Production (définitions relues le 08/11/2026).
CREATE OR REPLACE FUNCTION public.preserve_rdv_balance_token_after_payment()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.balance_paid_at IS NULL
     AND NEW.balance_paid_at IS NOT NULL
     AND OLD.balance_payment_token_hash IS NOT NULL
     AND NEW.balance_payment_token_hash IS NULL
  THEN
    NEW.balance_payment_token_hash := OLD.balance_payment_token_hash;
    NEW.balance_payment_token_expires_at := OLD.balance_payment_token_expires_at;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER preserve_rdv_balance_token_after_payment BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION preserve_rdv_balance_token_after_payment();

CREATE OR REPLACE FUNCTION public.normalize_mediumia_rdv_financial_kind()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.source = 'mediumia'
    AND NEW.direction = 'income'
    AND NEW.payment_method = 'paypal'
    AND NEW.entry_kind = 'arrhes'
    AND NEW.service_price_cents IS NOT NULL
    AND NEW.gross_cents = NEW.service_price_cents
  THEN
    NEW.entry_kind := 'full_payment';
    NEW.note := 'Paiement intégral du rendez-vous MediumIA';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER rdv_financial_normalize_full_payment BEFORE INSERT ON public.rdv_financial_entries FOR EACH ROW EXECUTE FUNCTION normalize_mediumia_rdv_financial_kind();

-- Fonctions de Production utilisées par les fonctions remplacées (inchangées).
CREATE OR REPLACE FUNCTION public.rdv_booking_paid_cents(p_booking_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(SUM(
    CASE direction
      WHEN 'income' THEN gross_cents
      WHEN 'refund' THEN -gross_cents
      ELSE 0
    END
  ), 0)::INTEGER
  FROM public.rdv_financial_entries
  WHERE booking_id = p_booking_id
    AND source = 'mediumia';
$function$;

CREATE OR REPLACE FUNCTION public.rdv_balance_external_payment_cents(p_booking_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(CASE e.direction WHEN 'income' THEN e.gross_cents ELSE -e.gross_cents END), 0)::INTEGER
  FROM public.rdv_financial_entries e
  JOIN public.bookings b ON b.id = p_booking_id
  WHERE e.booking_id IS NULL
    AND e.appointment_starts_at = b.starts_at
    AND b.customer_email IS NOT NULL
    AND lower(e.customer_email) = lower(b.customer_email);
$$;
