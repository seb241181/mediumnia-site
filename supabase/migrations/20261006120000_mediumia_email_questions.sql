-- MediumIA — questions personnelles par e-mail
-- MVP : 1 question 19,90 € / 2 questions 29,90 €.
-- Données serveur uniquement ; aucun accès direct navigateur.

CREATE TABLE IF NOT EXISTS public.mediumia_email_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paypal_env TEXT NOT NULL CHECK (paypal_env IN ('sandbox','live')),
  paypal_order_id TEXT NOT NULL UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  paypal_refund_id TEXT UNIQUE,
  pack TEXT NOT NULL CHECK (pack IN ('q1','q2')),
  question_count INTEGER NOT NULL CHECK (
    (pack = 'q1' AND question_count = 1)
    OR (pack = 'q2' AND question_count = 2)
  ),
  amount_cents INTEGER NOT NULL CHECK (
    (pack = 'q1' AND amount_cents = 1990)
    OR (pack = 'q2' AND amount_cents = 2990)
  ),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  first_name TEXT NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 80),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 5 AND 254),
  birth_date DATE,
  questions JSONB NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  status TEXT NOT NULL DEFAULT 'payment_pending'
    CHECK (status IN ('payment_pending','paid','in_progress','answered','refund_pending','refunded','manual_review')),
  due_at TIMESTAMPTZ,
  answer_text TEXT,
  refusal_reason TEXT,
  terms_version TEXT NOT NULL,
  terms_accepted_at TIMESTAMPTZ NOT NULL,
  immediate_service_accepted_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  confirmation_email_status TEXT,
  answer_email_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mediumia_email_questions_status_due_idx
  ON public.mediumia_email_questions(status, due_at);

CREATE INDEX IF NOT EXISTS mediumia_email_questions_created_idx
  ON public.mediumia_email_questions(created_at DESC);

ALTER TABLE public.mediumia_email_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mediumia_email_questions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mediumia_email_questions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mediumia_email_questions TO service_role;
