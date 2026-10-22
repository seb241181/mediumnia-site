-- Rencontres pédagogiques en visio incluses dans la Formation complète.
-- Accès serveur uniquement (service_role) : les droits de l'élève sont calculés par
-- lib/formationRencontres.js et transmis aux fonctions ci-dessous, qui verrouillent
-- la rencontre pour garantir la capacité et l'absence de double réservation.

create table if not exists public.formation_rencontres (
  id uuid primary key default gen_random_uuid(),
  theme_key text not null check (theme_key in ('premiers-apprentissages', 'perceptions-discernement', 'pratique-techniques', 'approfondissement', 'integration-autonomie')),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null default 5 check (capacity between 1 and 100),
  bookings_open boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint formation_rencontres_dates check (ends_at > starts_at),
  constraint formation_rencontres_theme_start unique (theme_key, starts_at)
);

-- booked : place réservée ; cancelled : annulée (élève ≥ 24 h avant, ou MediumIA) ;
-- attended / absent : participation utilisée ; released : absence avec rattrapage accordé.
create table if not exists public.formation_rencontre_bookings (
  id uuid primary key default gen_random_uuid(),
  rencontre_id uuid not null references public.formation_rencontres(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  theme_key text not null,
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'attended', 'absent', 'released')),
  cancelled_by text check (cancelled_by in ('student', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Une seule participation incluse par thème : une réservation en cours ou utilisée bloque le thème.
create unique index if not exists formation_rencontre_bookings_one_per_theme
  on public.formation_rencontre_bookings (user_id, theme_key)
  where status in ('booked', 'attended', 'absent');

create index if not exists formation_rencontre_bookings_rencontre
  on public.formation_rencontre_bookings (rencontre_id, status);

alter table public.formation_rencontres enable row level security;
alter table public.formation_rencontre_bookings enable row level security;
revoke all on public.formation_rencontres from public, anon, authenticated;
revoke all on public.formation_rencontre_bookings from public, anon, authenticated;

create or replace function public.formation_rencontre_book(p_user_id uuid, p_rencontre_id uuid, p_rights_from timestamptz, p_rights_until timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.formation_rencontres%rowtype;
  v_booked integer;
  v_id uuid;
begin
  select * into r from public.formation_rencontres where id = p_rencontre_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.status <> 'scheduled' then return jsonb_build_object('ok', false, 'reason', 'cancelled'); end if;
  if not r.bookings_open then return jsonb_build_object('ok', false, 'reason', 'bookings_closed'); end if;
  if r.starts_at <= now() then return jsonb_build_object('ok', false, 'reason', 'started'); end if;
  if p_rights_from is null or p_rights_until is null then return jsonb_build_object('ok', false, 'reason', 'not_eligible'); end if;
  if r.starts_at < p_rights_from or r.starts_at > p_rights_until then return jsonb_build_object('ok', false, 'reason', 'outside_rights'); end if;
  if exists (
    select 1 from public.formation_rencontre_bookings
    where user_id = p_user_id and theme_key = r.theme_key and status in ('booked', 'attended', 'absent')
  ) then return jsonb_build_object('ok', false, 'reason', 'theme_used'); end if;

  select count(*) into v_booked from public.formation_rencontre_bookings where rencontre_id = r.id and status = 'booked';
  if v_booked >= r.capacity then return jsonb_build_object('ok', false, 'reason', 'full'); end if;

  insert into public.formation_rencontre_bookings (rencontre_id, user_id, theme_key)
  values (r.id, p_user_id, r.theme_key)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'booking_id', v_id, 'places_left', r.capacity - v_booked - 1);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'theme_used');
end;
$$;

create or replace function public.formation_rencontre_cancel(p_user_id uuid, p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.formation_rencontre_bookings%rowtype;
  v_starts timestamptz;
begin
  select * into b from public.formation_rencontre_bookings where id = p_booking_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if b.status <> 'booked' then return jsonb_build_object('ok', false, 'reason', 'not_booked'); end if;
  select starts_at into v_starts from public.formation_rencontres where id = b.rencontre_id;
  if v_starts - now() < interval '24 hours' then return jsonb_build_object('ok', false, 'reason', 'too_late'); end if;
  update public.formation_rencontre_bookings
     set status = 'cancelled', cancelled_by = 'student', updated_at = now()
   where id = b.id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.formation_rencontre_admin_update(p_rencontre_id uuid, p_capacity integer default null, p_bookings_open boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.formation_rencontres%rowtype;
  v_booked integer;
begin
  select * into r from public.formation_rencontres where id = p_rencontre_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_capacity is not null then
    if p_capacity < 1 or p_capacity > 100 then return jsonb_build_object('ok', false, 'reason', 'invalid_capacity'); end if;
    select count(*) into v_booked from public.formation_rencontre_bookings where rencontre_id = r.id and status = 'booked';
    if p_capacity < v_booked then return jsonb_build_object('ok', false, 'reason', 'below_booked', 'booked', v_booked); end if;
  end if;
  update public.formation_rencontres
     set capacity = coalesce(p_capacity, capacity),
         bookings_open = coalesce(p_bookings_open, bookings_open),
         updated_at = now()
   where id = r.id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.formation_rencontre_admin_mark(p_booking_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.formation_rencontre_bookings%rowtype;
begin
  select * into b from public.formation_rencontre_bookings where id = p_booking_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not (
    (p_status in ('attended', 'absent') and b.status in ('booked', 'attended', 'absent'))
    or (p_status = 'released' and b.status = 'absent')
    or (p_status = 'cancelled' and b.status = 'booked')
  ) then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
  update public.formation_rencontre_bookings
     set status = p_status,
         cancelled_by = case when p_status = 'cancelled' then 'admin' else cancelled_by end,
         updated_at = now()
   where id = b.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.formation_rencontre_book(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.formation_rencontre_cancel(uuid, uuid) from public, anon, authenticated;
revoke all on function public.formation_rencontre_admin_update(uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.formation_rencontre_admin_mark(uuid, text) from public, anon, authenticated;
grant execute on function public.formation_rencontre_book(uuid, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.formation_rencontre_cancel(uuid, uuid) to service_role;
grant execute on function public.formation_rencontre_admin_update(uuid, integer, boolean) to service_role;
grant execute on function public.formation_rencontre_admin_mark(uuid, text) to service_role;

-- Premier cycle : réservations fermées tant que le propriétaire ne les ouvre pas.
insert into public.formation_rencontres (theme_key, title, starts_at, ends_at) values
  ('premiers-apprentissages', 'Premiers apprentissages', '2027-01-16T10:00:00+01:00', '2027-01-16T12:00:00+01:00'),
  ('perceptions-discernement', 'Perceptions et discernement', '2027-02-13T10:00:00+01:00', '2027-02-13T12:00:00+01:00'),
  ('pratique-techniques', 'Pratique et techniques', '2027-03-13T10:00:00+01:00', '2027-03-13T12:00:00+01:00'),
  ('approfondissement', 'Approfondissement', '2027-04-10T10:00:00+02:00', '2027-04-10T12:00:00+02:00'),
  ('integration-autonomie', 'Intégration et autonomie', '2027-05-22T10:00:00+02:00', '2027-05-22T12:00:00+02:00')
on conflict (theme_key, starts_at) do nothing;
