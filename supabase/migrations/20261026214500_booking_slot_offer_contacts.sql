-- Optional contact details for practitioner-owned emergency slot offers.
-- Never returned by the public token-based booking endpoint.
ALTER TABLE public.booking_slot_offers
  ADD COLUMN IF NOT EXISTS customer_phone text,
  ADD COLUMN IF NOT EXISTS customer_email text;
COMMENT ON COLUMN public.booking_slot_offers.customer_phone IS 'Private contact phone provided by the practitioner for reminders.';
COMMENT ON COLUMN public.booking_slot_offers.customer_email IS 'Private contact email provided by the practitioner for reminders.';
