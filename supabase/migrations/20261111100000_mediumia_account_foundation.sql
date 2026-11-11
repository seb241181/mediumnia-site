-- Espace client MediumIA — fondations (lot 1).
--
-- Principe : l'identité d'un compte est une adresse e-mail PROUVÉE (confirmée
-- par Supabase Auth). Un compte voit les rendez-vous réservés avec l'une de ses
-- adresses vérifiées. Le prénom, le nom et le téléphone ne servent jamais au
-- rattachement ; aucune fusion automatique.
--
-- Additive et rejouable. Aucune fonction de paiement n'est modifiée.
-- Tables et fonctions réservées au serveur (service_role).

-- ── 1. Profil : coordonnées et préférences de consultation ─────────────────
-- (mediumia_profiles existe déjà : RLS « own », lecture/écriture par le client.)

alter table public.mediumia_profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone_e164 text,
  add column if not exists preferred_modality text,
  add column if not exists preferred_video_channel text;

alter table public.mediumia_profiles drop constraint if exists mediumia_profiles_first_name_length;
alter table public.mediumia_profiles add constraint mediumia_profiles_first_name_length
  check (first_name is null or char_length(first_name) <= 80);
alter table public.mediumia_profiles drop constraint if exists mediumia_profiles_last_name_length;
alter table public.mediumia_profiles add constraint mediumia_profiles_last_name_length
  check (last_name is null or char_length(last_name) <= 80);
alter table public.mediumia_profiles drop constraint if exists mediumia_profiles_phone_format;
alter table public.mediumia_profiles add constraint mediumia_profiles_phone_format
  check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$');
alter table public.mediumia_profiles drop constraint if exists mediumia_profiles_preferred_modality_check;
alter table public.mediumia_profiles add constraint mediumia_profiles_preferred_modality_check
  check (preferred_modality is null or preferred_modality in ('video', 'in-person'));
alter table public.mediumia_profiles drop constraint if exists mediumia_profiles_preferred_video_channel_check;
alter table public.mediumia_profiles add constraint mediumia_profiles_preferred_video_channel_check
  check (preferred_video_channel is null or preferred_video_channel in ('whatsapp', 'facetime'));

-- ── 2. Adresses e-mail vérifiées d'un compte ────────────────────────────────
-- Une adresse n'appartient qu'à un seul compte (unique). Plusieurs adresses
-- par compte sont possibles (changement d'e-mail, ancienne adresse).

create table if not exists public.mediumia_account_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null
    check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  verified_at timestamptz not null,
  verified_via text not null check (verified_via in ('auth_primary', 'email_code')),
  created_at timestamptz not null default now(),
  constraint uq_mediumia_account_emails_email unique (email)
);

create index if not exists idx_mediumia_account_emails_user
  on public.mediumia_account_emails (user_id);

alter table public.mediumia_account_emails enable row level security;
revoke all on table public.mediumia_account_emails from public, anon, authenticated;
grant select on table public.mediumia_account_emails to service_role;

-- ── 3. Enregistrer l'adresse principale confirmée du compte ─────────────────
-- Lit auth.users : seule une adresse confirmée (email_confirmed_at) est
-- retenue. Si l'adresse est déjà rattachée à un autre compte, rien n'est
-- rattaché (jamais de fusion automatique).

create or replace function public.mediumia_account_sync_primary_email(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_verified_at timestamptz;
  v_owner uuid;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_user');
  end if;

  select lower(btrim(u.email)), u.email_confirmed_at
    into v_email, v_verified_at
  from auth.users u
  where u.id = p_user_id;

  if v_email is null or v_email = '' or v_verified_at is null then
    return jsonb_build_object('ok', false, 'error', 'email_not_verified');
  end if;

  insert into public.mediumia_account_emails (user_id, email, verified_at, verified_via)
  values (p_user_id, v_email, v_verified_at, 'auth_primary')
  on conflict (email) do nothing;

  select e.user_id into v_owner from public.mediumia_account_emails e where e.email = v_email;
  if v_owner is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'error', 'email_linked_to_other_account');
  end if;

  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

revoke all on function public.mediumia_account_sync_primary_email(uuid) from public, anon, authenticated;
grant execute on function public.mediumia_account_sync_primary_email(uuid) to service_role;
