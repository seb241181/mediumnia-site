-- Fonctions du paiement des rendez-vous : réservées au serveur.
--
-- Audit du 06/11/2026 : ces fonctions SECURITY DEFINER étaient exécutables avec la clé
-- publique du site (rôles anon et authenticated). convert_rdv_deposit_hold confirme un
-- rendez-vous sans interroger PayPal (c'est le serveur qui vérifie la capture avant de
-- l'appeler) : un appel direct aurait permis de confirmer un rendez-vous sans payer.
-- Seul le serveur les appelle (clé service_role) : aucun changement de fonctionnement.
revoke execute on function public.create_rdv_deposit_hold(uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.create_rdv_full_payment_hold(uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.claim_rdv_deposit_capture(text) from public, anon, authenticated;
revoke execute on function public.convert_rdv_deposit_hold(text, text, timestamptz, text, integer, text) from public, anon, authenticated;

grant execute on function public.create_rdv_deposit_hold(uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, uuid, text, text, boolean) to service_role;
grant execute on function public.create_rdv_full_payment_hold(uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, uuid, text, text, boolean) to service_role;
grant execute on function public.claim_rdv_deposit_capture(text) to service_role;
grant execute on function public.convert_rdv_deposit_hold(text, text, timestamptz, text, integer, text) to service_role;
