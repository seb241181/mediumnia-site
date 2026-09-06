alter table public.booking_practitioners
  add column if not exists is_platform_admin boolean not null default false;

comment on column public.booking_practitioners.is_platform_admin is
  'Grants access to MediumIA platform-wide pilotage analytics in the authenticated pro dashboard.';
