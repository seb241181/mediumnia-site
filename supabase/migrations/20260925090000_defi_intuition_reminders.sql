-- Défi Intuition : rappel quotidien par e-mail, facultatif.
--
-- Migration préparée, à appliquer manuellement par le propriétaire (SQL Editor Supabase).
-- Accès serveur uniquement (clé service_role) : RLS activée sans aucune policy.
-- Seule l'adresse e-mail est conservée, avec la date du consentement ; la
-- désinscription garde la ligne (date de retrait) pour ne plus jamais écrire.

create table if not exists public.defi_reminders (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and char_length(email) between 5 and 254),
  consent_at timestamptz not null,
  last_sent_on date,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists defi_reminders_due_idx
  on public.defi_reminders (last_sent_on nulls first)
  where unsubscribed_at is null;

alter table public.defi_reminders enable row level security;
revoke all on table public.defi_reminders from public, anon, authenticated;
