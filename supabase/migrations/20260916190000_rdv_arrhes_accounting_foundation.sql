-- MediumIA Rendez-vous — arrhes + journal financier.
-- Fondation uniquement : aucune migration n'est appliquée automatiquement à la production.

ALTER TABLE public.booking_services
  ADD COLUMN IF NOT EXISTS reservation_payment_kind TEXT NOT NULL DEFAULT 'none'
    CHECK (reservation_payment_kind IN ('none', 'arrhes')),
  ADD COLUMN IF NOT EXISTS reservation_payment_cents INTEGER NOT NULL DEFAULT 0
    CHECK (reservation_payment_cents >= 0),
  ADD COLUMN IF NOT EXISTS vat_rate_bps INTEGER NOT NULL DEFAULT 2000
    CHECK (vat_rate_bps >= 0 AND vat_rate_bps <= 10000);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_services_reservation_payment_price_chk'
  ) THEN
    ALTER TABLE public.booking_services
      ADD CONSTRAINT booking_services_reservation_payment_price_chk
      CHECK (
        reservation_payment_kind = 'none'
        OR (
          reservation_payment_cents > 0
          AND price_cents IS NOT NULL
          AND reservation_payment_cents <= price_cents
        )
      );
  END IF;
END $$;

-- Sébastien : 20 € d'arrhes pour chaque réservation instantanée.
-- Les prestations "sur demande" restent sans paiement avant validation manuelle.
UPDATE public.booking_services s
SET reservation_payment_kind = 'arrhes',
    reservation_payment_cents = 2000
FROM public.booking_practitioners p
WHERE p.id = s.practitioner_id
  AND p.slug = 'sebastien-seguin'
  AND s.booking_mode = 'instant'
  AND s.is_active = true;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booked_price_cents INTEGER
    CHECK (booked_price_cents IS NULL OR booked_price_cents > 0),
  ADD COLUMN IF NOT EXISTS reservation_payment_cents INTEGER
    CHECK (reservation_payment_cents IS NULL OR reservation_payment_cents >= 0),
  ADD COLUMN IF NOT EXISTS booking_source TEXT NOT NULL DEFAULT 'mediumia'
    CHECK (booking_source IN ('mediumia', 'reservio', 'manual'));

CREATE TABLE IF NOT EXISTS public.rdv_financial_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE RESTRICT,
  service_id UUID REFERENCES public.booking_services(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('mediumia', 'reservio', 'manual')),
  entry_kind TEXT NOT NULL CHECK (entry_kind IN (
    'arrhes', 'balance', 'full_payment', 'refund', 'arrhes_retained', 'adjustment'
  )),
  direction TEXT NOT NULL CHECK (direction IN ('income', 'refund')),
  payment_method TEXT NOT NULL CHECK (payment_method IN (
    'paypal', 'card', 'cash', 'check', 'transfer', 'other'
  )),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gross_cents INTEGER NOT NULL CHECK (gross_cents > 0),
  net_cents INTEGER NOT NULL CHECK (net_cents >= 0),
  vat_cents INTEGER NOT NULL CHECK (vat_cents >= 0),
  vat_rate_bps INTEGER NOT NULL CHECK (vat_rate_bps >= 0 AND vat_rate_bps <= 10000),
  vat_status TEXT NOT NULL DEFAULT 'taxable' CHECK (vat_status IN ('taxable', 'outside_scope', 'review')),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  service_price_cents INTEGER CHECK (service_price_cents IS NULL OR service_price_cents > 0),
  appointment_starts_at TIMESTAMPTZ,
  customer_name TEXT,
  customer_email TEXT,
  external_booking_ref TEXT,
  external_payment_ref TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (net_cents + vat_cents = gross_cents)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rdv_financial_entries_external_payment_ref
  ON public.rdv_financial_entries (source, external_payment_ref)
  WHERE external_payment_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rdv_financial_entries_occurred_at
  ON public.rdv_financial_entries (practitioner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_rdv_financial_entries_booking
  ON public.rdv_financial_entries (booking_id)
  WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rdv_financial_entries_source
  ON public.rdv_financial_entries (source, occurred_at DESC);

ALTER TABLE public.rdv_financial_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rdv_financial_entries FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rdv_financial_entries TO service_role;

COMMENT ON TABLE public.rdv_financial_entries IS
  'Journal financier RDV MediumIA/Reservio. Chaque encaissement est une ligne séparée selon sa date réelle.';
COMMENT ON COLUMN public.rdv_financial_entries.vat_status IS
  'taxable pour un encaissement soumis à TVA ; review permet de ne pas décider automatiquement le traitement fiscal d une somme conservée/exceptionnelle.';

CREATE OR REPLACE FUNCTION public.rdv_amount_breakdown(
  p_gross_cents INTEGER,
  p_vat_rate_bps INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  v_net INTEGER;
  v_vat INTEGER;
BEGIN
  IF p_gross_cents <= 0 OR p_vat_rate_bps < 0 OR p_vat_rate_bps > 10000 THEN
    RAISE EXCEPTION 'invalid_amount_breakdown';
  END IF;
  v_net := ROUND((p_gross_cents::NUMERIC * 10000) / (10000 + p_vat_rate_bps))::INTEGER;
  v_vat := p_gross_cents - v_net;
  RETURN jsonb_build_object('gross_cents', p_gross_cents, 'net_cents', v_net, 'vat_cents', v_vat, 'vat_rate_bps', p_vat_rate_bps);
END;
$$;

REVOKE ALL ON FUNCTION public.rdv_amount_breakdown(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rdv_amount_breakdown(INTEGER, INTEGER) TO service_role;
