-- MediumIA · Parcours 597 € · 04. CONTRÔLE FINAL DE L'HISTORIQUE (lecture seule)
-- À lancer après les réparations (étapes 2, 4 et 6 du runbook 00).
-- Aucun nombre total fixe : d'autres migrations peuvent être inscrites entre-temps.

-- 1. Les versions du parcours : attendu, une ligne, toutes les colonnes à true.
select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260925150000' and name = 'parcours_personal_pdfs_and_founder') as espace_eleve_inscrite,
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260926090000' and name = 'decouverte_credit_568') as credit_568_inscrite,
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260926100000' and name = 'formation_parcours_597') as parcours_597_inscrite,
  not exists (select 1 from supabase_migrations.schema_migrations where version = '20260925120000') as ancienne_34_absente;

-- 2. L'historique existant est intact. Remplacer COLLER_LA_LISTE_DU_BLOC_H par la
--    valeur « liste_versions » notée au bloc H du runbook 00 (entre les apostrophes).
--    Attendu : versions_disparues = 0 et empreinte_historique IDENTIQUE à celle du bloc H.
with avant(version) as (select unnest(string_to_array('COLLER_LA_LISTE_DU_BLOC_H', ',')))
select (select count(*) from avant) as versions_existantes,
       (select count(*) from avant a where not exists (select 1 from supabase_migrations.schema_migrations m where m.version = a.version)) as versions_disparues,
       (select md5(coalesce(string_agg(m.version || '|' || coalesce(m.name, '') || '|' || coalesce(array_to_string(m.statements, E'\n'), ''), E'\n' order by m.version), ''))
          from supabase_migrations.schema_migrations m join avant a on a.version = m.version) as empreinte_historique;

-- 3. Pour mémoire : versions inscrites depuis le début de l'opération (attendu : les 3
--    du parcours, plus d'éventuelles migrations sans rapport ajoutées entre-temps).
select version, name
from supabase_migrations.schema_migrations
where version >= '20260925150000'
order by version;
