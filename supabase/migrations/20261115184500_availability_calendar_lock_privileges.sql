-- Supabase may grant EXECUTE directly to anon/authenticated by default.
-- A REVOKE FROM PUBLIC alone does not remove those explicit grants.
-- Keep these SECURITY DEFINER lock helpers server-only.
revoke execute on function public.claim_availability_calendar_sync_lock(uuid, uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.release_availability_calendar_sync_lock(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.claim_availability_calendar_sync_lock(uuid, uuid, integer)
  to service_role;
grant execute on function public.release_availability_calendar_sync_lock(uuid, uuid)
  to service_role;
