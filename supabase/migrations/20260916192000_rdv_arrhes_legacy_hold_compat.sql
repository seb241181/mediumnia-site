-- Compatibilité avec l'ancien prototype PayPal RDV si ses tables existent déjà.
-- En production actuelle elles n'existent pas : cette migration y est donc un no-op.

DO $$
BEGIN
  IF to_regclass('public.rdv_booking_holds') IS NOT NULL THEN
    ALTER TABLE public.rdv_booking_holds
      ADD COLUMN IF NOT EXISTS service_price_cents INTEGER,
      ADD COLUMN IF NOT EXISTS reservation_payment_cents INTEGER,
      ADD COLUMN IF NOT EXISTS terms_version TEXT,
      ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ DEFAULT now(),
      ADD COLUMN IF NOT EXISTS early_performance_requested_at TIMESTAMPTZ;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='rdv_booking_holds' AND column_name='final_price_cents'
    ) THEN
      UPDATE public.rdv_booking_holds
      SET service_price_cents = COALESCE(service_price_cents, final_price_cents),
          reservation_payment_cents = COALESCE(reservation_payment_cents, final_price_cents)
      WHERE service_price_cents IS NULL OR reservation_payment_cents IS NULL;
      ALTER TABLE public.rdv_booking_holds ALTER COLUMN final_price_cents DROP NOT NULL;
    END IF;

    UPDATE public.rdv_booking_holds
    SET terms_version = COALESCE(terms_version, 'legacy-rdv-paypal'),
        terms_accepted_at = COALESCE(terms_accepted_at, created_at, now())
    WHERE terms_version IS NULL OR terms_accepted_at IS NULL;

    ALTER TABLE public.rdv_booking_holds
      ALTER COLUMN service_price_cents SET NOT NULL,
      ALTER COLUMN reservation_payment_cents SET NOT NULL,
      ALTER COLUMN terms_version SET NOT NULL,
      ALTER COLUMN terms_accepted_at SET NOT NULL;

    ALTER TABLE public.rdv_booking_holds
      DROP CONSTRAINT IF EXISTS rdv_booking_holds_selected_modality_check;
    ALTER TABLE public.rdv_booking_holds
      ADD CONSTRAINT rdv_booking_holds_selected_modality_check
      CHECK (selected_modality IN ('video', 'in-person'));

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rdv_booking_holds_service_price_chk') THEN
      ALTER TABLE public.rdv_booking_holds
        ADD CONSTRAINT rdv_booking_holds_service_price_chk CHECK (service_price_cents > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rdv_booking_holds_reservation_payment_chk') THEN
      ALTER TABLE public.rdv_booking_holds
        ADD CONSTRAINT rdv_booking_holds_reservation_payment_chk
        CHECK (reservation_payment_cents > 0 AND reservation_payment_cents <= service_price_cents);
    END IF;
  END IF;

  IF to_regclass('public.rdv_paypal_payments') IS NOT NULL THEN
    ALTER TABLE public.rdv_paypal_payments
      ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS google_sync_status TEXT,
      ADD COLUMN IF NOT EXISTS google_sync_error TEXT,
      ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
  END IF;
END $$;
