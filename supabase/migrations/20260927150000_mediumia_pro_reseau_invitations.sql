-- MediumIA Pro — étape 1 des assistants du Réseau.
--
-- 1. Invitations : l'administrateur invite un professionnel par e-mail. Le
--    professionnel crée son compte avec cette adresse puis active lui-même son
--    espace ; le serveur (service_role) crée alors son adhésion « pro ».
-- 2. Chaque assistant peut être rattaché à une fiche du Réseau (reseau_slug) et
--    être affiché publiquement sur cette fiche (public_enabled, étape 2).
--
-- Additif : aucune donnée existante n'est modifiée. Les invitations et
-- activations restent serveur-only. Les droits RLS historiques sur quelques
-- champs de profil sûrs de l'agent ne sont pas élargis par cette migration.

create table if not exists public.pro_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254),
  email_normalized text generated always as (lower(trim(email))) stored,
  reseau_slug text check (reseau_slug is null or reseau_slug ~ '^[a-z0-9-]{2,80}$'),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pro_invitations_one_pending_per_email_idx
  on public.pro_invitations(email_normalized)
  where status = 'pending';

-- Une fiche du Réseau ne peut avoir qu'une invitation active à la fois.
-- Une nouvelle invitation redevient possible après révocation.
create unique index if not exists pro_invitations_one_live_per_reseau_slug_idx
  on public.pro_invitations(reseau_slug)
  where reseau_slug is not null and status in ('pending', 'accepted');

create index if not exists pro_invitations_accepted_user_idx
  on public.pro_invitations(accepted_user_id)
  where accepted_user_id is not null;

alter table public.pro_invitations enable row level security;

drop trigger if exists pro_invitations_set_updated_at on public.pro_invitations;
create trigger pro_invitations_set_updated_at
before update on public.pro_invitations
for each row execute function public.set_updated_at();

revoke all on table public.pro_invitations from public, anon, authenticated;
grant select, insert, update on table public.pro_invitations to service_role;

comment on table public.pro_invitations is
  'Invitations MediumIA Pro (Réseau). Lecture et écriture réservées au serveur.';

alter table public.agents
  add column if not exists reseau_slug text
    check (reseau_slug is null or reseau_slug ~ '^[a-z0-9-]{2,80}$'),
  add column if not exists public_enabled boolean not null default false;

-- Une fiche du Réseau n'a qu'un assistant vivant.
create unique index if not exists agents_one_live_per_reseau_slug_idx
  on public.agents(reseau_slug)
  where reseau_slug is not null and status <> 'archived';

-- Le membre lit ces réglages ; il ne les modifie que via le serveur.
grant select (reseau_slug, public_enabled, limits) on public.agents to authenticated;

-- Vérification après exécution (attendu : 1 table, 2 colonnes) :
-- select count(*) from information_schema.tables
--   where table_schema = 'public' and table_name = 'pro_invitations';
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'agents'
--     and column_name in ('reseau_slug', 'public_enabled');
