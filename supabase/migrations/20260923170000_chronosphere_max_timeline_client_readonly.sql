-- ChronoSphère MAX : la mémoire du suivi devient en lecture seule côté navigateur.
--
-- Migration préparée, à appliquer manuellement par le propriétaire (SQL Editor Supabase).
--
-- Toutes les écritures (création du suivi, ajout d'une lecture, compteur) passent par
-- le serveur Vercel avec la clé service_role (lib/oracleTimeline.js), qui ignore RLS.
-- Un utilisateur connecté n'a donc aucune raison d'insérer, modifier ou supprimer
-- lui-même ses lignes : avec les droits actuels, il pourrait fabriquer de fausses
-- entrées de suivi ou effacer l'historique qui sert de mémoire aux lectures suivantes.
-- La lecture de ses propres lignes (policy *_select_own) est conservée.

begin;

revoke insert, update, delete on table public.chronosphere_timelines from authenticated;
revoke insert, update, delete on table public.chronosphere_timeline_entries from authenticated;

drop policy if exists chronosphere_timelines_insert_own on public.chronosphere_timelines;
drop policy if exists chronosphere_timelines_update_own on public.chronosphere_timelines;
drop policy if exists chronosphere_timelines_delete_own on public.chronosphere_timelines;
drop policy if exists chronosphere_timeline_entries_insert_own on public.chronosphere_timeline_entries;
drop policy if exists chronosphere_timeline_entries_update_own on public.chronosphere_timeline_entries;
drop policy if exists chronosphere_timeline_entries_delete_own on public.chronosphere_timeline_entries;

commit;

-- Vérification (doit renvoyer uniquement SELECT pour authenticated) :
-- select table_name, privilege_type from information_schema.role_table_grants
--  where grantee = 'authenticated' and table_name like 'chronosphere_timeline%';
