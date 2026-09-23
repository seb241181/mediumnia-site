-- Avis clients MediumIA : collecte, modération par le propriétaire, publication.
--
-- Migration préparée, à appliquer manuellement par le propriétaire (SQL Editor Supabase).
-- Tant qu'elle n'est pas appliquée, le site affiche « collecte bientôt ouverte » et
-- n'affiche aucun avis.
--
-- Accès : uniquement via le serveur (clé service_role, api/rdv-config.js?reviewsAction=…).
-- RLS activée sans aucune policy : ni anon ni authenticated ne peuvent lire l'e-mail
-- des auteurs ou publier eux-mêmes un avis.
-- Aucune adresse IP n'est stockée ; la limite d'envoi se fait par adresse e-mail.

create table if not exists public.customer_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  display_name text not null check (char_length(display_name) between 2 and 60),
  email text not null check (char_length(email) between 5 and 254),
  offering text not null check (offering in ('consultation', 'oracle', 'chronosphere', 'formation', 'conference', 'autre')),
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 30 and 1500),
  experience_month text check (experience_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  consent_publication boolean not null check (consent_publication),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  moderated_at timestamptz,
  rejection_reason text check (rejection_reason is null or rejection_reason in ('insulting', 'personal_data', 'off_topic', 'not_a_customer', 'duplicate', 'requested_by_author'))
);

create index if not exists customer_reviews_status_created_idx
  on public.customer_reviews (status, created_at desc);
create index if not exists customer_reviews_email_created_idx
  on public.customer_reviews (lower(email), created_at desc);

alter table public.customer_reviews enable row level security;
revoke all on table public.customer_reviews from public, anon, authenticated;

-- Vérification (doit renvoyer 0 ligne) :
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'customer_reviews' and grantee in ('anon', 'authenticated');
