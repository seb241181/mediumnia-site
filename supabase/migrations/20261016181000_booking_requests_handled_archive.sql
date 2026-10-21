-- MediumIA / Lumia: reversible non-financial archive of already processed
-- appointment requests. Existing status values and rows are unchanged.
-- A handled request is hidden from the working queue, not deleted.
ALTER TABLE public.booking_requests
  DROP CONSTRAINT booking_requests_status_check;

ALTER TABLE public.booking_requests
  ADD CONSTRAINT booking_requests_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'contacted'::text,
    'scheduled'::text,
    'rejected'::text,
    'cancelled'::text,
    'handled'::text
  ]));
