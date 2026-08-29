-- Table pour la liste d'attente MediumIA Pro
-- Les insertions passent exclusivement par le service_role (API serveur).

create table if not exists pro_waitlist (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  email text not null,
  email_normalized text not null,
  activity text not null,
  primary_need text not null,
  message text,
  consent_at timestamptz not null,
  status text not null default 'new'
    check (status in ('new','contacted','qualified','customer','archived')),
  source_page text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz not null default now()
);

create unique index if not exists pro_waitlist_email_normalized_idx
  on pro_waitlist (email_normalized);

alter table pro_waitlist enable row level security;

-- Aucune policy publique : toutes les opérations passent via service_role.
