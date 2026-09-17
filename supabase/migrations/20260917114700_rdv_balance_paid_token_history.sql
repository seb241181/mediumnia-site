-- Conserve le jeton opaque après règlement du solde afin que le lien de rappel
-- puisse encore afficher « entièrement réglé » si le client le rouvre.

CREATE OR REPLACE FUNCTION public.preserve_rdv_balance_token_after_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
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
$$;

DROP TRIGGER IF EXISTS preserve_rdv_balance_token_after_payment ON public.bookings;
CREATE TRIGGER preserve_rdv_balance_token_after_payment
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.preserve_rdv_balance_token_after_payment();

REVOKE ALL ON FUNCTION public.preserve_rdv_balance_token_after_payment() FROM PUBLIC, anon, authenticated;
