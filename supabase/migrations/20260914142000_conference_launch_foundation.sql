create extension if not exists pgcrypto;

create table if not exists public.conference_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  subtitle text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Europe/Paris',
  status text not null default 'draft' check (status in ('draft','registration_open','registration_closed','live','ended','cancelled')),
  capacity integer check (capacity is null or capacity > 0),
  zoom_join_url text,
  preparation_pdf_url text,
  pass_duration_hours integer not null default 48 check (pass_duration_hours between 1 and 720),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conference_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.conference_events(id) on delete cascade,
  first_name text not null check (char_length(trim(first_name)) between 1 and 80),
  email text not null,
  email_normalized text generated always as (lower(trim(email))) stored,
  status text not null default 'registered' check (status in ('registered','cancelled','attended','no_show')),
  source text,
  consent_transactional boolean not null default true,
  preparation_sent_at timestamptz,
  zoom_sent_at timestamptz,
  attended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, email_normalized)
);

create table if not exists public.conference_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.conference_events(id) on delete cascade,
  registration_id uuid references public.conference_registrations(id) on delete set null,
  question text not null check (char_length(trim(question)) between 3 and 1500),
  status text not null default 'pending' check (status in ('pending','selected','answered','dismissed')),
  cluster_key text,
  ai_summary text,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create table if not exists public.conference_passes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.conference_events(id) on delete cascade,
  registration_id uuid not null references public.conference_registrations(id) on delete cascade,
  token_hash text not null unique,
  offer_code text,
  discount_percent numeric(5,2) check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, registration_id)
);

create index if not exists conference_registrations_event_idx on public.conference_registrations(event_id, created_at desc);
create index if not exists conference_questions_event_status_idx on public.conference_questions(event_id, status, priority desc, created_at);
create index if not exists conference_passes_expiry_idx on public.conference_passes(expires_at) where redeemed_at is null;

alter table public.conference_events enable row level security;
alter table public.conference_registrations enable row level security;
alter table public.conference_questions enable row level security;
alter table public.conference_passes enable row level security;

revoke all on public.conference_events from anon, authenticated;
revoke all on public.conference_registrations from anon, authenticated;
revoke all on public.conference_questions from anon, authenticated;
revoke all on public.conference_passes from anon, authenticated;

grant all on public.conference_events to service_role;
grant all on public.conference_registrations to service_role;
grant all on public.conference_questions to service_role;
grant all on public.conference_passes to service_role;

comment on table public.conference_events is 'MediumIA conference source of truth. Server-only until explicit public APIs are installed.';
comment on table public.conference_registrations is 'Conference registration ledger. PII is server-only and never directly readable by browser roles.';
comment on table public.conference_questions is 'Live conference questions and AI triage metadata. Server-only.';
comment on table public.conference_passes is 'Hashed temporary post-conference offer passes. Raw pass tokens must never be stored.';
