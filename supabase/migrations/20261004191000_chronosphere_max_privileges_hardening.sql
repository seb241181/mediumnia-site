-- ChronoSphère MAX — privilèges minimaux côté navigateur.
--
-- Les privilèges par défaut de Supabase accordent aussi TRUNCATE, TRIGGER et
-- REFERENCES aux rôles anon et authenticated sur toute nouvelle table de public.
-- Ces tables n'en ont aucun besoin :
--   mediumia_profiles : le propriétaire lit, crée, modifie et efface son profil
--     (SELECT, INSERT, UPDATE, DELETE, sous RLS) ;
--   chronosphere_timelines / chronosphere_timeline_entries : lecture seule du
--     propriétaire (SELECT, sous RLS) ; les écritures passent par le serveur.
-- anon n'a aucun droit sur ces trois tables. Idempotente.

revoke truncate, trigger, references on table public.mediumia_profiles from public, anon, authenticated;
revoke all on table public.mediumia_profiles from anon;
revoke truncate, trigger, references on table public.chronosphere_timelines from public, anon, authenticated;
revoke truncate, trigger, references on table public.chronosphere_timeline_entries from public, anon, authenticated;
revoke all on table public.chronosphere_timelines from anon;
revoke all on table public.chronosphere_timeline_entries from anon;
revoke insert, update, delete on table public.chronosphere_timelines from authenticated;
revoke insert, update, delete on table public.chronosphere_timeline_entries from authenticated;
