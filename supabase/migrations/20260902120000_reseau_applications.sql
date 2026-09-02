-- Table des candidatures au Réseau MediumIA.
-- Stocke les demandes d'adhésion des praticiens souhaitant rejoindre l'annuaire.
-- Les insertions passent exclusivement par le service_role (API serveur).

-- Fonction utilitaire pour mettre à jour updated_at automatiquement.
-- Nommée spécifiquement pour éviter toute collision avec d'autres projets
-- partageant la même instance Supabase.
create or replace function reseau_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists reseau_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','invited','active')),

  -- Identité
  first_name text not null,
  last_name text not null,
  professional_name text,
  email text not null,
  email_normalized text not null,
  phone text,

  -- Localisation
  city text not null,
  department text not null,
  remote_sessions text not null
    check (remote_sessions in ('yes','no')),

  -- Présence en ligne
  website text,
  social_link text,

  -- Activité professionnelle
  main_activity text not null,
  specialties text not null,
  years_practice text not null,
  siret text,

  -- Descriptions libres
  practice_description text not null,
  approach_description text not null,
  target_audience text not null,
  motivation text not null,

  -- Consentements
  consent_accuracy boolean not null default false,
  consent_processing boolean not null default false,

  -- Tracking
  source_page text,

  -- Champs internes (jamais remplis par le navigateur)
  membership_type text,
  founder_number smallint,
  billing_plan text,

  -- Anti-spam
  honeypot text
);

create unique index if not exists reseau_applications_pending_email_idx
  on reseau_applications (email_normalized) where status = 'pending';

-- Mise à jour automatique de updated_at à chaque modification.
create trigger reseau_applications_set_updated_at
  before update on reseau_applications
  for each row
  execute function reseau_set_updated_at();

alter table reseau_applications enable row level security;

-- Aucune policy publique : toutes les opérations passent via service_role.
