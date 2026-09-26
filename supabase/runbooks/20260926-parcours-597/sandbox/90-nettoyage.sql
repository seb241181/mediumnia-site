-- MediumIA · Parcours 597 € · Sandbox · 90. NETTOYAGE DES COMPTES DE TEST (ÉCRIT — GO requis)
-- À la fin des tests, après avoir ARRÊTÉ dans « Mon parcours » tout abonnement Sandbox
-- encore vivant. Ne touche que les comptes « +parcours » et que leurs lignes Sandbox.
-- Les comptes eux-mêmes (auth.users) ne sont pas supprimés. Une seule transaction.
-- Les PDF de modules déposés pour ces comptes (<id>/parcours/…) se suppriment depuis
-- Storage (tableau de bord Supabase), jamais en SQL : liste en fin de fichier.

begin;

do $$
declare
  v_users uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_users from auth.users where email like '%+parcours%';
  if exists (select 1 from public.mediumia_formation_payments where user_id = any(v_users) and paypal_env = 'live')
     or exists (select 1 from public.mediumia_paypal_purchases where user_id = any(v_users) and paypal_env = 'live')
     or exists (select 1 from public.mediumia_formation_subscriptions where user_id = any(v_users) and paypal_env = 'live') then
    raise exception 'refuse : un compte de test a des lignes live';
  end if;
  if exists (select 1 from public.mediumia_formation_subscriptions where user_id = any(v_users) and status in ('approval_pending', 'active')) then
    raise exception 'refuse : arrêter d''abord les abonnements Sandbox encore vivants';
  end if;
  delete from public.mediumia_formation_payments where user_id = any(v_users) and paypal_env = 'sandbox';
  delete from public.mediumia_formation_unlock_orders where user_id = any(v_users) and paypal_env = 'sandbox';
  delete from public.mediumia_formation_subscriptions where user_id = any(v_users) and paypal_env = 'sandbox';
  delete from public.mediumia_entitlements where user_id = any(v_users) and (origin_ref like 'parcours:sandbox:%' or origin_ref like 'paypal:sandbox:%');
end;
$$;

commit;

-- Contrôle (attendu : 0 partout).
with u as (select id from auth.users where email like '%+parcours%')
select
  (select count(*) from public.mediumia_formation_payments f join u on u.id = f.user_id where f.paypal_env = 'sandbox') as registre,
  (select count(*) from public.mediumia_formation_subscriptions s join u on u.id = s.user_id where s.paypal_env = 'sandbox') as abonnements,
  (select count(*) from public.mediumia_formation_unlock_orders o join u on u.id = o.user_id where o.paypal_env = 'sandbox') as commandes,
  (select count(*) from public.mediumia_entitlements e join u on u.id = e.user_id where e.origin_ref like '%sandbox%') as droits_sandbox;

-- PDF de modules à supprimer dans Storage (chemins seulement).
select o.name
from storage.objects o
where o.bucket_id = 'mediumia-personal-pdfs' and o.name like '%/parcours/%'
  and split_part(o.name, '/', 1) in (select id::text from auth.users where email like '%+parcours%');
