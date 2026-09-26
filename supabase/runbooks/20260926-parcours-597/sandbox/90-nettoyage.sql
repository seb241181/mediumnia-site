-- MediumIA · Parcours 597 € · Sandbox · 90. NETTOYAGE DE LA CAMPAGNE DE TEST (ÉCRIT — GO requis)
-- À la fin des tests, après avoir ARRÊTÉ dans « Mon parcours » tout abonnement Sandbox
-- encore vivant.
--
-- Portée : UNIQUEMENT les 4 adresses de cette campagne, listées ci-dessous (une seule
-- fois, utilisées partout : garde-fous, suppressions, contrôle final, liste des PDF).
-- Aucun autre compte, même en « +parcours », présent ou futur, ne peut être touché.
-- Seules leurs lignes Sandbox sont supprimées ; les achats Sandbox restent (le lien
-- achat → droit passe à null), les comptes eux-mêmes (auth.users) ne sont pas supprimés.
-- Les PDF de modules se suppriment depuis Storage (tableau de bord), jamais en SQL :
-- leurs chemins sont listés dans le résultat final.

-- ▼▼▼ LES 4 ADRESSES DE LA CAMPAGNE (remplacer ADRESSE_1 … ADRESSE_4) ▼▼▼
drop table if exists pg_temp.campagne_sandbox;
create temp table campagne_sandbox (email text primary key);
insert into campagne_sandbox (email) values
  (lower(trim('ADRESSE_1'))),
  (lower(trim('ADRESSE_2'))),
  (lower(trim('ADRESSE_3'))),
  (lower(trim('ADRESSE_4')));
-- ▲▲▲ rien d'autre à modifier ▲▲▲

begin;

do $$
declare
  v_users uuid[];
begin
  -- La liste doit être exactement celle de la campagne : 4 adresses distinctes,
  -- toutes « +parcours », aucune valeur à remplacer oubliée.
  if (select count(*) from campagne_sandbox) <> 4
     or exists (select 1 from campagne_sandbox where email like '%adresse\_%' or email not like '%+parcours%@%') then
    raise exception 'refuse : la liste doit contenir exactement les 4 adresses « +parcours » de la campagne';
  end if;

  select coalesce(array_agg(u.id), '{}') into v_users
  from auth.users u join campagne_sandbox c on c.email = lower(u.email);

  if exists (select 1 from public.mediumia_formation_payments where user_id = any(v_users) and paypal_env = 'live')
     or exists (select 1 from public.mediumia_paypal_purchases where user_id = any(v_users) and paypal_env = 'live')
     or exists (select 1 from public.mediumia_formation_subscriptions where user_id = any(v_users) and paypal_env = 'live') then
    raise exception 'refuse : un compte de la campagne a des lignes live';
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

-- Contrôle final (seul résultat affiché). Attendu : comptes_trouves = nombre de
-- comptes de la campagne réellement créés (4 si tous ont servi), puis 0 · 0 · 0 · 0,
-- puis les chemins des PDF de modules à supprimer dans Storage (vide si aucun).
with u as (
  select u.id from auth.users u join campagne_sandbox c on c.email = lower(u.email)
)
select
  (select count(*) from u) as comptes_trouves,
  (select count(*) from public.mediumia_formation_payments f join u on u.id = f.user_id where f.paypal_env = 'sandbox') as registre,
  (select count(*) from public.mediumia_formation_subscriptions s join u on u.id = s.user_id where s.paypal_env = 'sandbox') as abonnements,
  (select count(*) from public.mediumia_formation_unlock_orders o join u on u.id = o.user_id where o.paypal_env = 'sandbox') as commandes,
  (select count(*) from public.mediumia_entitlements e join u on u.id = e.user_id where e.origin_ref like '%sandbox%') as droits_sandbox,
  (select coalesce(string_agg(o.name, ' · ' order by o.name), '') from storage.objects o
     where o.bucket_id = 'mediumia-personal-pdfs' and o.name like '%/parcours/%'
       and split_part(o.name, '/', 1) in (select id::text from u)) as pdf_a_supprimer_dans_storage;
