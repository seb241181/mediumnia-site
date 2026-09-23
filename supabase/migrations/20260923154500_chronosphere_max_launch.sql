-- ChronoSphère MAX — launch at 19,90 €.
-- Extends the existing 3-credit pack engine without changing the standard 9,90 € pack.
-- One MAX purchase belongs to one authenticated MediumIA user and follows one Ligne de Temps.

alter table public.chronosphere_credit_packs
  drop constraint if exists chronosphere_credit_packs_amount_cents_check;

alter table public.chronosphere_credit_packs
  add constraint chronosphere_credit_packs_amount_cents_check
  check (amount_cents in (100, 990, 1990));

alter table public.chronosphere_credit_packs
  add column if not exists product_type text not null default 'pack3'
    check (product_type in ('pack3', 'max3')),
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists chronosphere_credit_packs_user_product_status_idx
  on public.chronosphere_credit_packs (user_id, product_type, status, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chronosphere_credit_packs_user_id_id_key'
  ) then
    alter table public.chronosphere_credit_packs
      add constraint chronosphere_credit_packs_user_id_id_key unique (user_id, id);
  end if;
end $$;

alter table public.chronosphere_timelines
  add column if not exists max_pack_id uuid;

create unique index if not exists chronosphere_timelines_max_pack_unique_idx
  on public.chronosphere_timelines (max_pack_id)
  where max_pack_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chronosphere_timelines_user_pack_fk'
  ) then
    alter table public.chronosphere_timelines
      add constraint chronosphere_timelines_user_pack_fk
      foreign key (user_id, max_pack_id)
      references public.chronosphere_credit_packs (user_id, id)
      on delete restrict;
  end if;
end $$;
