-- Crédit Découverte : la Formation complète reste à 597 € TTC ; après une vraie
-- Découverte live payée 29 €, l'élève règle 568 € (29 + 568 = 597).
--
-- Migration additive, à appliquer manuellement par le propriétaire (SQL Editor Supabase).
-- Elle ne modifie aucune migration déjà appliquée et peut être relancée sans effet.
-- Aucun paiement, aucun accès et aucune capture existants ne sont modifiés :
-- seulement des colonnes vides, des règles de montant élargies et deux index uniques.
-- Tout s'applique en une seule transaction : si une instruction échoue, rien n'est modifié.

begin;

-- 1. Commandes (intentions de paiement) : rattachement au compte et à la Découverte.
alter table public.mediumia_paypal_order_intents
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists upgrade_credit_purchase_id uuid references public.mediumia_paypal_purchases(id) on delete restrict,
  add column if not exists upgrade_credit_claimed_at timestamptz;

-- Règles de montant existantes des commandes (quel que soit leur nom) remplacées.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.mediumia_paypal_order_intents'::regclass
      and c.contype = 'c'
      and (pg_get_constraintdef(c.oid) like '%amount_cents = 2900%'
        or c.conname = 'mediumia_paypal_order_intents_credit_check')
  loop
    execute format('alter table public.mediumia_paypal_order_intents drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.mediumia_paypal_order_intents
  add constraint mediumia_paypal_order_intents_amount_check check (
    (paypal_env = 'sandbox' and amount_cents = 100)
    or (paypal_env = 'live' and product_code = 'discovery' and amount_cents = 2900)
    or (paypal_env = 'live' and product_code = 'full' and amount_cents = 59700)
    or (paypal_env = 'live' and product_code = 'full' and amount_cents = 56800)
  ),
  -- 568 € si et seulement si une Découverte live est rattachée au compte connecté.
  add constraint mediumia_paypal_order_intents_credit_check check (
    (upgrade_credit_purchase_id is null and upgrade_credit_claimed_at is null
      and not (paypal_env = 'live' and product_code = 'full' and amount_cents = 56800))
    or (upgrade_credit_purchase_id is not null and user_id is not null
      and paypal_env = 'live' and product_code = 'full' and amount_cents = 56800)
  );

-- Une Découverte ne peut être réservée que par une seule commande à la fois.
create unique index if not exists ux_mediumia_order_intents_credit_claim
  on public.mediumia_paypal_order_intents (upgrade_credit_purchase_id)
  where upgrade_credit_claimed_at is not null;

-- 2. Achats : un achat complet live vaut 597 € ou, avec la Découverte, 568 €.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.mediumia_paypal_purchases'::regclass
      and c.contype = 'c'
      and (pg_get_constraintdef(c.oid) like '%amount_cents = 2900%'
        or c.conname = 'mediumia_paypal_purchases_product_amount_check')
  loop
    execute format('alter table public.mediumia_paypal_purchases drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.mediumia_paypal_purchases
  add constraint mediumia_paypal_purchases_product_amount_check check (
    (paypal_env = 'sandbox' and amount_cents = 100)
    or (paypal_env = 'live' and product_code = 'full' and amount_cents in (59700, 56800))
    or (paypal_env = 'live' and product_code = 'discovery' and amount_cents = 2900)
  );

-- Un achat complet ne consomme qu'une seule Découverte.
create unique index if not exists ux_mediumia_purchases_credit_redeemed_by
  on public.mediumia_paypal_purchases (upgrade_credit_redeemed_purchase_id)
  where upgrade_credit_redeemed_purchase_id is not null;

commit;

-- Vérification : 3 colonnes de crédit, 2 index, règles 59700 / 56800.
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'c'
  and conrelid in ('public.mediumia_paypal_order_intents'::regclass, 'public.mediumia_paypal_purchases'::regclass)
  and (pg_get_constraintdef(oid) like '%amount_cents = 2900%' or conname = 'mediumia_paypal_order_intents_credit_check')
order by 1, 2;
