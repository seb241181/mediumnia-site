-- MediumIA — ventes KDP signalées avant ventilation détaillée.
--
-- Permet d'afficher un total de ventes à jour sans inventer la répartition
-- broché / ebook ni les redevances tant que le nouveau relevé KDP n'a pas
-- encore été saisi.

alter table public.kdp_income_reports
  add column if not exists unclassified_units integer not null default 0
  check (unclassified_units >= 0);
