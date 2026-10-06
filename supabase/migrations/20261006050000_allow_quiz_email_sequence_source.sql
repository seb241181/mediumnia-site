alter table public.oracle_email_sequence_subscriptions
  drop constraint if exists oracle_email_sequence_source_check;

alter table public.oracle_email_sequence_subscriptions
  add constraint oracle_email_sequence_source_check
  check (source in ('oracle_free_result', 'formation_page', 'quiz_page'));

comment on column public.oracle_email_sequence_subscriptions.source is
  'Origin of explicit consent: Oracle free result, Formation page or quiz page.';
