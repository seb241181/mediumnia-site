-- Conférence avancée d'un jour : jeudi 22 octobre 2026 au lieu du vendredi 23,
-- aux mêmes horaires (19 h–20 h, heure de Paris). Le lien Zoom ne change pas.
--
-- Migration préparée, à appliquer manuellement par le propriétaire (SQL Editor Supabase).
-- Idempotente : ne décale que ce qui est encore au 23 octobre.

update public.conference_events
set starts_at = starts_at - interval '1 day',
    ends_at = ends_at - interval '1 day',
    updated_at = now()
where slug = 'premiere-conference-mediumia'
  and (starts_at at time zone 'Europe/Paris')::date = date '2026-10-23';

-- La fenêtre du tirage suit la conférence (19 h 50 – 19 h 57 le 22 octobre).
update public.conference_raffles r
set opens_at = r.opens_at - interval '1 day',
    closes_at = r.closes_at - interval '1 day',
    updated_at = now()
from public.conference_events e
where r.event_id = e.id
  and e.slug = 'premiere-conference-mediumia'
  and r.status <> 'drawn'
  and (r.opens_at at time zone 'Europe/Paris')::date = date '2026-10-23';

-- Vérification : doit afficher le jeudi 22 octobre, 19:00 → 20:00 et 19:50 → 19:57.
select e.starts_at at time zone 'Europe/Paris' as debut,
       e.ends_at at time zone 'Europe/Paris' as fin,
       r.opens_at at time zone 'Europe/Paris' as tirage_ouverture,
       r.closes_at at time zone 'Europe/Paris' as tirage_fermeture
from public.conference_events e
left join public.conference_raffles r on r.event_id = e.id
where e.slug = 'premiere-conference-mediumia';
