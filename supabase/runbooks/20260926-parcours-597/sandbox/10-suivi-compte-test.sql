-- MediumIA · Parcours 597 € · Sandbox · 10. SUIVI D'UN COMPTE DE TEST (lecture seule)
-- Remplacer ADRESSE_TEST par l'adresse du compte de test (une adresse « +parcours »).
-- À lancer après chaque scénario. N'affiche que ce compte, et seulement ses lignes Sandbox.

with u as (select id from auth.users where lower(email) = lower('ADRESSE_TEST') and email like '%+parcours%')
select 'achat' as quoi, p.product_code as detail, p.amount_cents::text as montant, p.status as etat, p.created_at as quand
  from public.mediumia_paypal_purchases p join u on u.id = p.user_id where p.paypal_env = 'sandbox'
union all
select 'registre', f.kind || coalesce(' (' || f.refunded_kind || ')', ''), f.value_cents::text, f.paypal_ref, f.paid_at
  from public.mediumia_formation_payments f join u on u.id = f.user_id where f.paypal_env = 'sandbox'
union all
select 'abonnement', s.regular_count || ' × ' || s.step_cents || ' puis ' || s.final_cents, null, s.status, s.created_at
  from public.mediumia_formation_subscriptions s join u on u.id = s.user_id where s.paypal_env = 'sandbox'
union all
select 'tout débloquer', null, o.amount_cents::text, o.status, o.created_at
  from public.mediumia_formation_unlock_orders o join u on u.id = o.user_id where o.paypal_env = 'sandbox'
union all
select 'droit', e.origin_ref || ' · ' || e.access_level || ' · module ' || e.max_module, null, e.status || ' jusqu''au ' || e.access_expires_at::date, e.access_started_at
  from public.mediumia_entitlements e join u on u.id = e.user_id where e.origin_ref like '%sandbox%'
order by quand;

-- Total compté par le parcours pour ce compte (Sandbox) : attendu ≤ 59700.
with u as (select id from auth.users where lower(email) = lower('ADRESSE_TEST') and email like '%+parcours%')
select coalesce(sum(case when kind = 'refund' then -value_cents else value_cents end), 0) as total_cents
from public.mediumia_formation_payments f join u on u.id = f.user_id where f.paypal_env = 'sandbox';
