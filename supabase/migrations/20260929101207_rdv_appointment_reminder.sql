-- MediumIA Rendez-vous — rappels de rendez-vous.
--
-- appointment_reminder_sent_at     : e-mail de rappel J-3 (un seul par RDV).
-- appointment_sms_reminder_sent_at : futur SMS J-1, marque distincte pour
--                                    éviter tout doublon (aucun prestataire
--                                    SMS n'est branché pour l'instant).
-- La tâche quotidienne réserve la ligne avant l'envoi. Additif : aucune donnée
-- existante n'est modifiée (colonnes vides pour tous les rendez-vous actuels).

alter table public.bookings
  add column if not exists appointment_reminder_sent_at timestamptz,
  add column if not exists appointment_sms_reminder_sent_at timestamptz;

create index if not exists bookings_appointment_reminder_due_idx
  on public.bookings(starts_at)
  where status = 'confirmed' and appointment_reminder_sent_at is null;

-- Vérification après exécution (attendu : 2) :
-- select count(*) from information_schema.columns
--   where table_schema = 'public' and table_name = 'bookings'
--     and column_name in ('appointment_reminder_sent_at', 'appointment_sms_reminder_sent_at');
