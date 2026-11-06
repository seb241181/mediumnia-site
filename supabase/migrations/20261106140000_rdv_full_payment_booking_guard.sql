-- Paiement intégral : la protection des rendez-vous accepte toutes les modalités proposées.
--
-- Incident TEST du 06/11/2026 : un paiement intégral en présentiel (80 €) a été capturé par
-- PayPal, puis la création du rendez-vous a été refusée par ce déclencheur, qui n'acceptait
-- le prix complet qu'en visio. La création du paiement intégral (20260923200000) ouvre le
-- présentiel : sans cette migration, un client pourrait payer sans obtenir son rendez-vous.
-- À déployer TOUJOURS avec 20260923200000, dans la même opération, et avant elle si séparées.
--
-- Inchangé : rendez-vous MediumIA d'une prestation instantanée à arrhes seulement ; prix
-- réservé = prix de la prestation ; montant réglé = arrhes OU prix complet, rien d'autre.
-- La modalité choisie est contrôlée à la création (elle doit figurer dans la prestation).
CREATE OR REPLACE FUNCTION public.enforce_mediumia_booking_reservation_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_service public.booking_services;
  v_valid BOOLEAN := false;
BEGIN
  IF NEW.booking_source <> 'mediumia' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = NEW.service_id;
  IF FOUND
    AND v_service.booking_mode = 'instant'
    AND v_service.reservation_payment_kind = 'arrhes'
  THEN
    v_valid := NEW.booked_price_cents IS NOT DISTINCT FROM v_service.price_cents
      AND (
        NEW.reservation_payment_cents IS NOT DISTINCT FROM v_service.reservation_payment_cents
        OR NEW.reservation_payment_cents IS NOT DISTINCT FROM v_service.price_cents
      );
    IF NOT v_valid THEN
      RAISE EXCEPTION 'reservation_payment_required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_mediumia_booking_reservation_payment() FROM PUBLIC, anon, authenticated;
