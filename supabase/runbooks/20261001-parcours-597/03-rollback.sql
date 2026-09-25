-- MediumIA · Parcours 597 € · 03. ROLLBACK de 20261001090000
-- À n'utiliser que si le contrôle 02 n'est pas conforme, AVANT l'ouverture du
-- parcours (interrupteur PAYPAL_FORMATION_PATH_ENABLED toujours absent / false).
-- Cas prévu : les tables du parcours n'existaient pas avant (bloc A du 01 = 4 × null).
-- Si elles existaient avant (ancienne migration 34 €), NE PAS lancer : me demander.
--
-- Retire ce que la migration a créé : les 4 tables du parcours (dont le registre,
-- qui n'est qu'une copie des achats), la fonction d'accès progressif, et remet la
-- règle d'origine des droits (Découverte = module 1, complet = module 25).
-- Les achats, commandes et droits existants ne sont pas touchés. Une seule transaction.

begin;

-- Garde-fou : refuse si le parcours a déjà servi (abonnement, commande, paiement
-- du parcours, droit « parcours » ou droit complet partiel).
do $$
begin
  if exists (select 1 from public.mediumia_formation_subscriptions)
     or exists (select 1 from public.mediumia_formation_unlock_orders)
     or exists (select 1 from public.mediumia_formation_payments where kind in ('monthly', 'unlock', 'refund'))
     or exists (select 1 from public.mediumia_entitlements where origin_ref like 'parcours:%')
     or exists (select 1 from public.mediumia_entitlements where access_level = 'full' and max_module <> 25)
  then
    raise exception 'rollback_refuse : le parcours a déjà servi';
  end if;
end;
$$;

drop function if exists public.mediumia_set_path_entitlement(uuid, text, integer, timestamptz);

drop table if exists public.mediumia_formation_unlock_orders;
drop table if exists public.mediumia_formation_subscriptions;
drop table if exists public.mediumia_formation_payments;
drop table if exists public.mediumia_paypal_plans;

alter table public.mediumia_entitlements drop constraint if exists mediumia_entitlements_level_scope_check;
alter table public.mediumia_entitlements add constraint mediumia_entitlements_level_scope_check
  check ((access_level = 'discovery' and max_module = 1) or (access_level = 'full' and max_module = 25));

commit;

-- Vérification (attendu : 4 × null, 0 fonction).
select to_regclass('public.mediumia_formation_payments') as registre,
       to_regclass('public.mediumia_formation_subscriptions') as abonnements,
       to_regclass('public.mediumia_formation_unlock_orders') as tout_debloquer,
       to_regclass('public.mediumia_paypal_plans') as plans,
       (select count(*) from pg_proc where proname = 'mediumia_set_path_entitlement') as fonction;
