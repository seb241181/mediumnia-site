-- ChronoSphère 999 : un crédit de courtoisie sans règlement PayPal.
-- Appliqué et vérifié en TEST puis PROD le 2 novembre 2026.
-- L'accès n'est pas public : émission manuelle par administrateur privilégié,
-- et le lien secret #resume contient un jeton fort dont seul le SHA-256 est stocké.
-- La fonction existante consume_chronosphere_pack_credit sérialise le seul crédit.
-- La validité de six mois est calculée sur created_at, sans date d'encaissement.
-- Pas de "capture" fictive ni d'écriture de chiffre d'affaires.
-- Migration idempotente pour l'historisation du schéma déjà appliqué.

BEGIN;

ALTER TABLE public.chronosphere_credit_packs
  ADD COLUMN IF NOT EXISTS grant_kind text NOT NULL DEFAULT 'purchase',
  ADD COLUMN IF NOT EXISTS grant_reference text;

ALTER TABLE public.chronosphere_credit_packs
  ALTER COLUMN paypal_order_id DROP NOT NULL,
  ALTER COLUMN paypal_env DROP NOT NULL,
  ALTER COLUMN consent_accepted_at DROP NOT NULL;

ALTER TABLE public.chronosphere_credit_packs
  DROP CONSTRAINT IF EXISTS chronosphere_credit_packs_grant_kind_check,
  DROP CONSTRAINT IF EXISTS chronosphere_credit_packs_amount_cents_check,
  DROP CONSTRAINT IF EXISTS chronosphere_credit_packs_credits_total_check,
  DROP CONSTRAINT IF EXISTS chronosphere_credit_packs_product_type_check,
  DROP CONSTRAINT IF EXISTS chronosphere_credit_packs_paypal_env_check,
  DROP CONSTRAINT IF EXISTS chronosphere_credit_packs_payment_state;

ALTER TABLE public.chronosphere_credit_packs
  ADD CONSTRAINT chronosphere_credit_packs_grant_kind_check
    CHECK (grant_kind IN ('purchase','courtesy')),
  ADD CONSTRAINT chronosphere_credit_packs_amount_cents_check
    CHECK ((grant_kind='purchase' AND amount_cents IN (100,990,1990))
      OR (grant_kind='courtesy' AND amount_cents=0)),
  ADD CONSTRAINT chronosphere_credit_packs_credits_total_check
    CHECK ((grant_kind='purchase' AND credits_total=3)
      OR (grant_kind='courtesy' AND credits_total=1)),
  ADD CONSTRAINT chronosphere_credit_packs_product_type_check
    CHECK ((grant_kind='purchase' AND product_type IN ('pack3','max3'))
      OR (grant_kind='courtesy' AND product_type='gift1')),
  ADD CONSTRAINT chronosphere_credit_packs_paypal_env_check
    CHECK ((grant_kind='purchase' AND paypal_env IN ('sandbox','live'))
      OR (grant_kind='courtesy' AND paypal_env IS NULL)),
  ADD CONSTRAINT chronosphere_credit_packs_payment_state
    CHECK (
      (grant_kind='purchase' AND paypal_order_id IS NOT NULL AND consent_accepted_at IS NOT NULL
       AND (
         (status='payment_pending' AND paypal_capture_id IS NULL AND captured_at IS NULL AND credits_remaining=0)
         OR
         (status='active' AND paypal_capture_id IS NOT NULL AND captured_at IS NOT NULL
          AND credits_remaining BETWEEN 1 AND credits_total)
         OR
         (status='exhausted' AND paypal_capture_id IS NOT NULL AND captured_at IS NOT NULL AND credits_remaining=0)
       ))
      OR
      (grant_kind='courtesy' AND paypal_order_id IS NULL AND paypal_capture_id IS NULL
       AND paypal_env IS NULL AND captured_at IS NULL AND consent_accepted_at IS NULL
       AND status IN ('active','exhausted')
       AND ((status='active' AND credits_remaining=1) OR (status='exhausted' AND credits_remaining=0)))
    );

CREATE UNIQUE INDEX IF NOT EXISTS chronosphere_credit_packs_grant_reference_unique
  ON public.chronosphere_credit_packs(grant_reference)
  WHERE grant_reference IS NOT NULL;

COMMIT;

-- Pour offrir un accès : générer 32 octets cryptographiquement aléatoires,
-- conserver uniquement SHA256(jeton) en base, grant_kind='courtesy',
-- product_type='gift1', credits_total=credits_remaining=1, amount_cents=0,
-- paypal_order_id/paypal_capture_id/paypal_env/captured_at/consent_accepted_at NULL,
-- et référencer la commande d'origine dans grant_reference (unique).
-- Transmettre https://mediumia.fr/chronosphere#resume=<jeton> au bénéficiaire.
-- Ne jamais exposer un service public permettant d'émettre un crédit sans auth administrateur.
