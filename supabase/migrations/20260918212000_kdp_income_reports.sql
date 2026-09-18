-- MediumIA — suivi des revenus Amazon KDP.
-- Sépare les redevances générées des encaissements RDV afin de ne pas
-- présenter une redevance KDP estimée comme un virement bancaire déjà reçu.

CREATE TABLE IF NOT EXISTS public.kdp_income_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  period_month DATE NOT NULL,
  snapshot_date DATE NOT NULL,
  title TEXT NOT NULL DEFAULT 'Codex: Le Livre de l''Arche',
  paperback_units INTEGER NOT NULL DEFAULT 0 CHECK (paperback_units >= 0),
  ebook_units INTEGER NOT NULL DEFAULT 0 CHECK (ebook_units >= 0),
  hardcover_units INTEGER NOT NULL DEFAULT 0 CHECK (hardcover_units >= 0),
  free_ebook_units INTEGER NOT NULL DEFAULT 0 CHECK (free_ebook_units >= 0),
  paperback_royalty_cents INTEGER NOT NULL DEFAULT 0 CHECK (paperback_royalty_cents >= 0),
  ebook_royalty_cents INTEGER NOT NULL DEFAULT 0 CHECK (ebook_royalty_cents >= 0),
  hardcover_royalty_cents INTEGER NOT NULL DEFAULT 0 CHECK (hardcover_royalty_cents >= 0),
  royalty_cents INTEGER NOT NULL CHECK (royalty_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  payout_status TEXT NOT NULL DEFAULT 'estimated' CHECK (payout_status IN ('estimated', 'paid')),
  paid_at TIMESTAMPTZ,
  payout_reference TEXT,
  source_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_month = date_trunc('month', period_month)::date),
  CHECK (royalty_cents = paperback_royalty_cents + ebook_royalty_cents + hardcover_royalty_cents),
  CHECK ((payout_status = 'estimated' AND paid_at IS NULL) OR payout_status = 'paid')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kdp_income_reports_practitioner_month
  ON public.kdp_income_reports (practitioner_id, period_month);

CREATE INDEX IF NOT EXISTS idx_kdp_income_reports_period
  ON public.kdp_income_reports (practitioner_id, period_month DESC);

ALTER TABLE public.kdp_income_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kdp_income_reports FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kdp_income_reports TO service_role;

COMMENT ON TABLE public.kdp_income_reports IS
  'Synthèses mensuelles Amazon KDP. Les redevances estimated sont générées/à recevoir et ne doivent pas être confondues avec un virement bancaire déjà encaissé.';
