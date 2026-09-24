-- Demande d'avis Google après une consultation.
--
-- Migration préparée, à appliquer manuellement par le propriétaire (SQL Editor Supabase).
-- Tant qu'elle n'est pas appliquée, la tâche quotidienne ignore simplement cette étape.
--
-- review_request_sent_at est posé AVANT l'envoi (réservation atomique de la ligne) :
-- chaque rendez-vous reçoit au plus une demande, même si la tâche est relancée.

alter table public.bookings
  add column if not exists review_request_sent_at timestamptz;

create index if not exists bookings_review_request_pending_idx
  on public.bookings (ends_at)
  where status = 'confirmed' and review_request_sent_at is null;

-- La tâche quotidienne ne considère que les rendez-vous terminés depuis 12 h à 4 jours :
-- les anciens clients ne reçoivent pas de demande tardive.
