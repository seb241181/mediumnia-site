-- MediumIA Rendez-vous — rappel de rendez-vous par e-mail la veille.
--
-- Un seul rappel par rendez-vous : la tâche quotidienne réserve la ligne
-- (appointment_reminder_sent_at) avant l'envoi. Additif : aucune donnée
-- existante n'est modifiée (colonne vide pour tous les rendez-vous actuels).

alter table public.bookings
  add column if not exists appointment_reminder_sent_at timestamptz;

create index if not exists bookings_appointment_reminder_due_idx
  on public.bookings(starts_at)
  where status = 'confirmed' and appointment_reminder_sent_at is null;

-- Vérification après exécution (attendu : 1) :
-- select count(*) from information_schema.columns
--   where table_schema = 'public' and table_name = 'bookings' and column_name = 'appointment_reminder_sent_at';
