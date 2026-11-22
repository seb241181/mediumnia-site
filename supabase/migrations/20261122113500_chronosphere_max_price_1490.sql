-- ChronoSphère MAX passe de 19,90 € à 14,90 € pour les nouvelles commandes.
-- Les commandes historiques à 19,90 € et les accès offerts à 0 € restent valides.
-- La contrainte précédente tient compte de grant_kind (purchase/courtesy).
ALTER TABLE public.chronosphere_credit_packs
  DROP CONSTRAINT IF EXISTS chronosphere_credit_packs_amount_cents_check;

ALTER TABLE public.chronosphere_credit_packs
  ADD CONSTRAINT chronosphere_credit_packs_amount_cents_check
  CHECK (
    (grant_kind = 'purchase' AND amount_cents IN (100, 990, 1490, 1990))
    OR (grant_kind = 'courtesy' AND amount_cents = 0)
  );
