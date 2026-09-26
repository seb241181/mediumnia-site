-- MediumIA · Parcours 597 € · Sandbox · 20. MENSUALITÉS SIMULÉES (ÉCRIT — GO requis)
-- PayPal ne prélève la mensualité suivante qu'un mois plus tard : pour tester la
-- dernière échéance et le plafond, on inscrit N mensualités Sandbox fictives de 48 €
-- pour UN compte de test qui a déjà sa Découverte Sandbox (scénario S1).
-- Remplacer ADRESSE_TEST et NOMBRE (10 dans le plan de test). Une seule transaction.
-- Garde-fous : compte « +parcours » uniquement, Sandbox uniquement, jamais de ligne
-- live pour ce compte, aucun vrai prélèvement déjà fait, pas d'abonnement vivant,
-- références « TEST-SANDBOX-… »
-- (supprimées par 90-nettoyage.sql).

begin;

do $$
declare
  v_user uuid;
  v_count integer := NOMBRE;
begin
  select id into v_user from auth.users where lower(email) = lower('ADRESSE_TEST') and email like '%+parcours%';
  if v_user is null then raise exception 'compte_test_introuvable (adresse « +parcours » requise)'; end if;
  if v_count not between 1 and 11 then raise exception 'nombre_invalide'; end if;
  if exists (select 1 from public.mediumia_formation_payments where user_id = v_user and paypal_env = 'live')
     or exists (select 1 from public.mediumia_paypal_purchases where user_id = v_user and paypal_env = 'live') then
    raise exception 'refuse : ce compte a des paiements réels';
  end if;
  if not exists (select 1 from public.mediumia_formation_payments where user_id = v_user and paypal_env = 'sandbox' and kind = 'discovery') then
    raise exception 'refuse : faire d''abord la Découverte Sandbox (S1)';
  end if;
  if exists (select 1 from public.mediumia_formation_payments where user_id = v_user and kind in ('monthly', 'unlock') and paypal_ref not like 'TEST-SANDBOX-%') then
    raise exception 'refuse : ce compte a déjà un vrai prélèvement Sandbox (le total dépasserait 597 €)';
  end if;
  if exists (select 1 from public.mediumia_formation_subscriptions where user_id = v_user and status in ('approval_pending', 'active')) then
    raise exception 'refuse : arrêter d''abord l''abonnement en cours';
  end if;
  insert into public.mediumia_formation_payments (user_id, paypal_env, kind, amount_cents, value_cents, paypal_ref, paid_at)
  select v_user, 'sandbox', 'monthly', 4800, 4800, 'TEST-SANDBOX-' || v_user::text || '-' || n, now() - make_interval(days => 30 * (v_count - n + 1))
  from generate_series(1, v_count) n
  on conflict (paypal_ref) do nothing;
end;
$$;

commit;

-- Contrôle : NOMBRE lignes « TEST-SANDBOX-… » pour ce compte.
select count(*) as mensualites_simulees
from public.mediumia_formation_payments
where paypal_ref like 'TEST-SANDBOX-%' and user_id = (select id from auth.users where lower(email) = lower('ADRESSE_TEST'));
