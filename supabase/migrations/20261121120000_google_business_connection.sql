-- Connexion Google Business Profile (lecture des avis de la fiche MediumIA).
--
-- Volontairement séparée de Google Agenda (booking_calendar_connections) :
-- autre client OAuth, autre droit (business.manage), autre stockage. Une seule
-- ligne (id = 1) : la fiche de Sébastien Seguin.
--
-- Le jeton de rafraîchissement est chiffré côté serveur (AES-256-GCM) avant
-- d'être écrit ici ; il n'est jamais renvoyé au navigateur. Aucun avis n'est
-- stocké : ils sont lus chez Google à la demande.
--
-- Accès : uniquement le serveur (service_role). RLS forcée, aucune policy.

create table if not exists public.google_business_connection (
  id smallint primary key default 1 check (id = 1),
  refresh_token_enc text,
  granted_scope text check (granted_scope is null or granted_scope = 'https://www.googleapis.com/auth/business.manage'),
  account_name text check (account_name is null or account_name ~ '^accounts/[A-Za-z0-9_-]+$'),
  location_name text check (location_name is null or location_name ~ '^locations/[A-Za-z0-9_-]+$'),
  location_title text check (location_title is null or char_length(location_title) <= 120),
  connected_by uuid,
  connected_at timestamptz,
  pending_state_hash text check (pending_state_hash is null or pending_state_hash ~ '^[0-9a-f]{64}$'),
  pending_expires_at timestamptz,
  pending_user_id uuid,
  last_success_at timestamptz,
  last_error text check (last_error is null or last_error ~ '^[a-z0-9_]{1,60}$'),
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.google_business_connection is
  'Connexion OAuth Google Business Profile (avis). Jeton chiffré, service_role uniquement. Distincte de Google Agenda.';

alter table public.google_business_connection enable row level security;
alter table public.google_business_connection force row level security;
revoke all on table public.google_business_connection from public, anon, authenticated;
grant select, insert, update, delete on table public.google_business_connection to service_role;
