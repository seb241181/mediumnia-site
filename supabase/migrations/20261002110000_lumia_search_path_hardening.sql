-- Lumia RDV — durcissement : search_path fixe sur les trois fonctions SQL
-- utilitaires introduites par Lumia (avertissement Supabase
-- « function_search_path_mutable »).
--
-- Les migrations déjà appliquées (20261002085000, 20261002090000) ne sont pas
-- réécrites : cette migration ALTER les fonctions existantes.
--
-- search_path = '' (le plus strict) : les corps n'utilisent que des fonctions
-- natives (pg_catalog, toujours résolu) et l'appel interne est qualifié
-- (public.mediumia_name_key). Aucune table n'est lue par ces fonctions.
--
-- Hors périmètre (antérieurs à Lumia, non modifiés ici) :
-- rdv_amount_breakdown, mediumia_set_updated_at. Idempotente.

ALTER FUNCTION public.mediumia_name_key(TEXT) SET search_path = '';
ALTER FUNCTION public.mediumia_names_compatible(TEXT, TEXT, TEXT, TEXT) SET search_path = '';
ALTER FUNCTION public.lumia_normalize_phone(TEXT) SET search_path = '';
