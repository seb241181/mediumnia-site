-- MediumIA · Crédit Découverte 597 / 568 · ROLLBACK de 20260926090000
-- À n'utiliser que si le contrôle après migration n'est pas conforme, AVANT le merge du
-- correctif. Remet exactement les règles d'origine (achat complet live = 59700 seulement)
-- et retire les colonnes et index de crédit (vides à ce stade). Une seule transaction.

begin;

-- Garde-fou : refuse si le nouveau checkout a déjà servi (commande ou achat à 568 €, crédit).
do $$
begin
  if exists (select 1 from public.mediumia_paypal_order_intents
             where amount_cents = 56800 or user_id is not null
                or upgrade_credit_purchase_id is not null or upgrade_credit_claimed_at is not null)
     or exists (select 1 from public.mediumia_paypal_purchases
                where amount_cents = 56800 or upgrade_credit_redeemed_at is not null)
  then
    raise exception 'rollback_refuse : le crédit Découverte a déjà été utilisé';
  end if;
end;
$$;

drop index if exists public.ux_mediumia_order_intents_credit_claim;
drop index if exists public.ux_mediumia_purchases_credit_redeemed_by;

alter table public.mediumia_paypal_order_intents
  drop constraint if exists mediumia_paypal_order_intents_credit_check,
  drop constraint if exists mediumia_paypal_order_intents_amount_check;
alter table public.mediumia_paypal_order_intents
  add constraint mediumia_paypal_order_intents_amount_check check (
    (paypal_env = 'sandbox' and amount_cents = 100)
    or (paypal_env = 'live' and product_code = 'discovery' and amount_cents = 2900)
    or (paypal_env = 'live' and product_code = 'full' and amount_cents = 59700)
  );
alter table public.mediumia_paypal_order_intents
  drop column if exists upgrade_credit_claimed_at,
  drop column if exists upgrade_credit_purchase_id,
  drop column if exists user_id;

alter table public.mediumia_paypal_purchases
  drop constraint if exists mediumia_paypal_purchases_product_amount_check;
alter table public.mediumia_paypal_purchases
  add constraint mediumia_paypal_purchases_product_amount_check check (
    (paypal_env = 'sandbox' and amount_cents = 100)
    or (paypal_env = 'live' and product_code = 'full' and amount_cents = 59700)
    or (paypal_env = 'live' and product_code = 'discovery' and amount_cents = 2900)
  );

commit;
