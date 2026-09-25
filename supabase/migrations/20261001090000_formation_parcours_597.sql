-- Parcours MediumIA au mois, modèle définitif 597 € TTC :
--   Découverte 29 € → 11 × 48 € (2 modules à chaque fois) → dernière mensualité 40 €
--   = 597 €, le prix de la Formation complète, jamais plus.
--
-- Remplace, pour les montants, la migration 20260925120000 (ancien modèle 34 €) :
--   - si ses tables n'existent pas encore, elles sont créées ici directement
--     avec les règles 597 € (20260925120000 ne doit alors PAS être lancée) ;
--   - si elles existent déjà, seules les règles de montant sont remplacées.
-- Idempotente : peut être relancée sans effet de bord. Tout ou rien (transaction).
-- Aucun paiement enregistré n'est modifié ni supprimé.
--
-- Migration préparée, à appliquer manuellement par le propriétaire (SQL Editor
-- Supabase), après le runbook supabase/runbooks/20261001-parcours-597/.
-- Accès serveur uniquement (clé service_role) : RLS activée sans aucune policy.

begin;

-- 1. Registre des paiements encaissés pour la formation (source de vérité du plafond).
create table if not exists public.mediumia_formation_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  kind text not null check (kind in ('discovery', 'full', 'monthly', 'unlock', 'refund')),
  refunded_kind text check (refunded_kind is null or refunded_kind in ('discovery', 'full', 'monthly', 'unlock')),
  -- Montant réellement encaissé (ou remboursé), en centimes.
  amount_cents integer not null check (amount_cents > 0),
  -- Valeur pour le parcours : égale au montant en production ; en Sandbox la
  -- Découverte et l'achat complet sont facturés 1 € mais valent leur prix réel.
  value_cents integer not null check (value_cents > 0),
  paypal_ref text not null unique,
  paypal_subscription_id text,
  paid_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((kind = 'refund') = (refunded_kind is not null))
);

create index if not exists mediumia_formation_payments_user_idx
  on public.mediumia_formation_payments (user_id, paypal_env);

-- 2. Abonnements mensuels (48 € répétés, puis la dernière mensualité).
--    Les règles de montant sont posées au point 5.
create table if not exists public.mediumia_formation_subscriptions (
  paypal_subscription_id text primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  paypal_plan_id text not null,
  regular_count integer not null,
  step_cents integer not null,
  final_cents integer not null,
  status text not null default 'approval_pending'
    check (status in ('approval_pending', 'active', 'suspended', 'cancelled', 'expired', 'completed')),
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  last_synced_at timestamptz
);

-- Un seul abonnement vivant par élève et par environnement.
create unique index if not exists mediumia_formation_subscriptions_one_live
  on public.mediumia_formation_subscriptions (user_id, paypal_env)
  where status in ('approval_pending', 'active');

-- 3. Paiement « Tout débloquer » / dernière mensualité en une fois (commande PayPal).
create table if not exists public.mediumia_formation_unlock_orders (
  paypal_order_id text primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  amount_cents integer not null,
  status text not null default 'created' check (status in ('created', 'captured', 'refused')),
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  captured_at timestamptz
);

-- 4. Plans PayPal créés automatiquement (un par environnement et par modèle).
create table if not exists public.mediumia_paypal_plans (
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  code text not null,
  paypal_product_id text not null,
  paypal_plan_id text not null,
  created_at timestamptz not null default now(),
  primary key (paypal_env, code)
);

alter table public.mediumia_formation_payments enable row level security;
alter table public.mediumia_formation_subscriptions enable row level security;
alter table public.mediumia_formation_unlock_orders enable row level security;
alter table public.mediumia_paypal_plans enable row level security;
revoke all on table public.mediumia_formation_payments from public, anon, authenticated;
revoke all on table public.mediumia_formation_subscriptions from public, anon, authenticated;
revoke all on table public.mediumia_formation_unlock_orders from public, anon, authenticated;
revoke all on table public.mediumia_paypal_plans from public, anon, authenticated;

-- 5. Règles de montant 597 €. Les anciennes règles (34 €, 368 €), quel que soit
--    leur nom, sont retirées d'après leur définition, puis remplacées.
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    where c.contype = 'c'
      and (
        (c.conrelid = 'public.mediumia_formation_subscriptions'::regclass
          and pg_get_constraintdef(c.oid) ~ '(step_cents|final_cents|regular_count)')
        or (c.conrelid = 'public.mediumia_formation_unlock_orders'::regclass
          and pg_get_constraintdef(c.oid) ~ 'amount_cents')
      )
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end
$$;

-- Au plus 11 × 48 € puis une dernière mensualité de 48 € au plus, et jamais plus
-- de 568 € prélevés par un abonnement (597 € − la Découverte). Seule exception :
-- d'éventuels essais Sandbox de l'ancien modèle 34 € (argent fictif), conservés tels quels.
alter table public.mediumia_formation_subscriptions
  add constraint mediumia_formation_subscriptions_amounts_597_check check (
    (step_cents = 4800
      and regular_count between 1 and 11
      and final_cents between 1 and 4800
      and regular_count * step_cents + final_cents <= 56800)
    or (paypal_env = 'sandbox'
      and step_cents = 3400
      and regular_count between 1 and 11
      and final_cents between 1 and 3400)
  );

-- « Tout débloquer » : au plus 568 € (597 € − la Découverte).
alter table public.mediumia_formation_unlock_orders
  add constraint mediumia_formation_unlock_orders_amount_597_check check (amount_cents between 1 and 56800);

-- 6. Les achats déjà provisionnés comptent dans le parcours (idempotent).
--    Achat complet live à 568 € (crédit Découverte) : valeur 568 €, et la
--    Découverte 29 € déjà enregistrée complète les 597 €.
insert into public.mediumia_formation_payments (user_id, paypal_env, kind, amount_cents, value_cents, paypal_ref, paid_at)
select p.user_id,
       p.paypal_env,
       p.product_code,
       p.amount_cents,
       case when p.paypal_env = 'live' then p.amount_cents
            when p.product_code = 'discovery' then 2900
            else 59700 end,
       p.paypal_capture_id,
       coalesce(p.captured_at, p.provisioned_at, now())
from public.mediumia_paypal_purchases p
where p.status = 'provisioned'
  and p.user_id is not null
  and p.paypal_capture_id is not null
  and p.product_code in ('discovery', 'full')
on conflict (paypal_ref) do nothing;

-- 7. Accès progressif : un accès « full » peut couvrir 1 à 25 modules (le
--    parcours monte de 2 en 2). Découverte inchangée (module 1).
alter table public.mediumia_entitlements drop constraint if exists mediumia_entitlements_level_scope_check;
alter table public.mediumia_entitlements add constraint mediumia_entitlements_level_scope_check
  check ((access_level = 'discovery' and max_module = 1) or (access_level = 'full' and max_module between 1 and 25));

-- Un seul droit d'accès « parcours » par élève et par environnement, mis à jour
-- à chaque paiement encaissé (module maximum et fin d'accès recalculés).
create or replace function public.mediumia_set_path_entitlement(
  p_user_id uuid,
  p_env text,
  p_max_module integer,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := 'parcours:' || p_env || ':' || p_user_id::text;
  v_row public.mediumia_entitlements%rowtype;
begin
  if p_user_id is null or p_env not in ('sandbox', 'live') or p_max_module not between 1 and 25 or p_expires_at is null then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  insert into public.mediumia_students (user_id) values (p_user_id) on conflict (user_id) do nothing;

  -- A path row at module 1 (Discovery bought with the parcours open) keeps the
  -- Discovery level, so the coach uses the Discovery frame.
  update public.mediumia_entitlements
  set max_module = p_max_module,
      access_level = case when p_max_module = 1 then 'discovery' else 'full' end,
      access_expires_at = p_expires_at,
      status = 'active',
      updated_at = now()
  where type = 'purchase' and origin_ref = v_ref
  returning * into v_row;

  if not found then
    insert into public.mediumia_entitlements (user_id, type, origin_ref, access_started_at, access_expires_at, status, access_level, max_module)
    values (p_user_id, 'purchase', v_ref, now(), p_expires_at, 'active', case when p_max_module = 1 then 'discovery' else 'full' end, p_max_module)
    returning * into v_row;
  end if;

  return jsonb_build_object('status', 'ok', 'entitlement_id', v_row.id, 'max_module', v_row.max_module, 'access_expires_at', v_row.access_expires_at);
end;
$$;

revoke all on function public.mediumia_set_path_entitlement(uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.mediumia_set_path_entitlement(uuid, text, integer, timestamptz) to service_role;

commit;
