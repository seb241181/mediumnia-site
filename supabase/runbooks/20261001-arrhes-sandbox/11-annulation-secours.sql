-- Base de TEST uniquement (wnbwhnqiulsdjcvkuwos). À n'utiliser que si l'e-mail
-- de confirmation (lien d'annulation) n'arrive pas. Même effet que l'annulation
-- par le client : statut seulement, aucun mouvement d'argent.
-- Remplacer ADRESSE_DE_TEST. Ne touche qu'un RDV confirmé de cette adresse.
update public.bookings
set status = 'cancelled',
    cancelled_at = now(),
    cancel_reason = 'client_self_service',
    updated_at = now()
where lower(customer_email) = lower('ADRESSE_DE_TEST')
  and status = 'confirmed'
  and booking_source = 'mediumia'
  and starts_at > now() + interval '48 hours'
returning id, status, starts_at;
-- L'événement reste alors dans le calendrier TEST : le supprimer à la main.
