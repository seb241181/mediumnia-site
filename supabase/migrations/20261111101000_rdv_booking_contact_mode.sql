-- Mode de consultation enregistré avec le rendez-vous (lot 1 de l'espace client).
--
-- MediumIA n'utilise aucun lien de visioconférence : à distance, Sébastien
-- contacte le client par WhatsApp ou FaceTime, selon son choix.
--
-- Colonnes facultatives : les rendez-vous existants restent à NULL
-- (« information non connue », rien n'est inventé). Aucune fonction de
-- paiement n'est modifiée : le serveur recopie le choix du blocage vers le
-- rendez-vous, et la lecture sait retomber sur le blocage.
-- Additive et rejouable.

alter table public.bookings
  add column if not exists modality text,
  add column if not exists video_channel text;

alter table public.bookings drop constraint if exists bookings_modality_check;
alter table public.bookings add constraint bookings_modality_check
  check (modality is null or modality in ('video', 'in-person'));

alter table public.bookings drop constraint if exists bookings_video_channel_check;
alter table public.bookings add constraint bookings_video_channel_check
  check (
    video_channel is null
    or (video_channel in ('whatsapp', 'facetime', 'a_preciser') and modality = 'video')
  );

alter table public.rdv_booking_holds
  add column if not exists video_channel text;

alter table public.rdv_booking_holds drop constraint if exists rdv_booking_holds_video_channel_check;
alter table public.rdv_booking_holds add constraint rdv_booking_holds_video_channel_check
  check (
    video_channel is null
    or (video_channel in ('whatsapp', 'facetime', 'a_preciser') and selected_modality = 'video')
  );
