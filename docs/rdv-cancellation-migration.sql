-- MediumIA Rendez-vous — socle minimal pour les liens d'annulation sécurisés.
-- Appliqué sur Supabase le 26 août 2026 sous la migration
-- add_booking_cancellation_token_fields.

ALTER TABLE public.bookings
  ADD COLUMN cancellation_token_hash TEXT NULL,
  ADD COLUMN cancellation_token_created_at TIMESTAMPTZ NULL;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_cancellation_token_hash_format
  CHECK (
    cancellation_token_hash IS NULL
    OR cancellation_token_hash ~ '^[0-9a-f]{64}$'
  );

CREATE UNIQUE INDEX bookings_cancellation_token_hash_uidx
  ON public.bookings (cancellation_token_hash)
  WHERE cancellation_token_hash IS NOT NULL;
