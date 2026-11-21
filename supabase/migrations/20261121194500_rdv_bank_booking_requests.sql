-- MediumIA : demande de virement pour réservation à plus de 4 jours.
-- Nouvelle structure additive ; aucune modification des flux PayPal.
create table if not exists public.rdv_bank_booking_requests (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null unique references public.rdv_booking_holds(id) on delete restrict,
  client_checkout_id uuid not null unique,
  transfer_reference text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  payment_choice text not null check (payment_choice in ('arrhes','full_payment')),
  status text not null default 'pending' check (status in ('pending','confirmed','expired','cancelled')),
  confirmed_booking_id uuid unique references public.bookings(id) on delete restrict,
  confirmed_by uuid,
  confirmed_at timestamptz,
  pending_email_sent_at timestamptz,
  confirmation_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rdv_bank_requests_status_idx on public.rdv_bank_booking_requests(status, created_at);
alter table public.rdv_bank_booking_requests enable row level security;
revoke all on public.rdv_bank_booking_requests from public, anon, authenticated;
grant select,insert,update on public.rdv_bank_booking_requests to service_role;

create or replace function public.create_rdv_bank_booking_request(
  p_practitioner_id uuid, p_service_id uuid,
  p_starts_at timestamptz, p_ends_at timestamptz,
  p_selected_modality text, p_video_channel text,
  p_first_name text, p_last_name text, p_email text, p_phone text, p_message text,
  p_client_checkout_id uuid, p_payment_choice text,
  p_terms_version text, p_early_performance boolean
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_practitioner public.booking_practitioners;
  v_service public.booking_services;
  v_prior record; v_hold_id uuid; v_request_id uuid;
  v_before interval; v_after interval;
  v_count integer; v_expires timestamptz; v_amount integer;
  v_reference text;
begin
  if p_starts_at is null or p_starts_at < now()+interval '4 days' then
    return jsonb_build_object('ok',false,'error','bank_min_4_days');
  end if;
  if p_client_checkout_id is null or p_payment_choice not in ('arrhes','full_payment')
    or p_terms_version is null or length(trim(p_terms_version)) < 3 then
    return jsonb_build_object('ok',false,'error','invalid_request');
  end if;
  if p_first_name is null or length(trim(p_first_name)) not between 1 and 80
     or p_last_name is null or length(trim(p_last_name)) not between 1 and 80
     or p_email is null or length(trim(p_email)) not between 5 and 254
     or trim(p_email) !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    return jsonb_build_object('ok',false,'error','invalid_customer');
  end if;
  if p_video_channel is not null and (
    p_selected_modality <> 'video' or p_video_channel not in ('whatsapp','facetime','a_preciser')
  ) then return jsonb_build_object('ok',false,'error','invalid_modality'); end if;
  perform pg_advisory_xact_lock(hashtext(p_practitioner_id::text));
  select r.*,h.practitioner_id,h.service_id,h.starts_at,h.customer_email,h.expires_at
    into v_prior from public.rdv_bank_booking_requests r
    join public.rdv_booking_holds h on h.id=r.hold_id
    where r.client_checkout_id=p_client_checkout_id for update of r,h;
  if found then
    if v_prior.practitioner_id<>p_practitioner_id or v_prior.service_id<>p_service_id
      or v_prior.starts_at<>p_starts_at or v_prior.customer_email<>lower(trim(p_email))
      or v_prior.payment_choice<>p_payment_choice then
      return jsonb_build_object('ok',false,'error','checkout_context_changed');
    end if;
    return jsonb_build_object('ok',v_prior.status='pending' and v_prior.expires_at>now(),
      'existing',true,'request_id',v_prior.id,'reference',v_prior.transfer_reference,
      'expires_at',v_prior.expires_at,'amount_cents',v_prior.amount_cents,
      'status',case when v_prior.expires_at<=now() and v_prior.status='pending' then 'expired' else v_prior.status end);
  end if;
  select * into v_practitioner from public.booking_practitioners
    where id=p_practitioner_id and is_active and booking_enabled;
  if not found then return jsonb_build_object('ok',false,'error','booking_unavailable'); end if;
  if p_starts_at > now()+make_interval(days=>coalesce(v_practitioner.booking_horizon_days,42))
    or p_starts_at<now()+make_interval(hours=>coalesce(v_practitioner.min_advance_hours,0)) then
    return jsonb_build_object('ok',false,'error','outside_horizon');
  end if;
  select * into v_service from public.booking_services where id=p_service_id
    and practitioner_id=p_practitioner_id and is_active
    and booking_mode='instant' and reservation_payment_kind='arrhes';
  if not found or v_service.price_cents <= 0 or v_service.reservation_payment_cents <= 0
    or v_service.reservation_payment_cents>v_service.price_cents
    or v_service.currency<>'EUR'
    or p_selected_modality is null or not(p_selected_modality=any(v_service.modality))
    or p_ends_at is distinct from p_starts_at+make_interval(mins=>v_service.duration_min) then
    return jsonb_build_object('ok',false,'error','service_not_payable');
  end if;
  v_before:=make_interval(mins=>coalesce(v_practitioner.buffer_before_min,0));
  v_after:=make_interval(mins=>coalesce(v_practitioner.buffer_after_min,0));
  if exists(select 1 from public.bookings b where b.practitioner_id=p_practitioner_id and b.status='confirmed'
    and b.starts_at-v_before<p_ends_at+v_after and b.ends_at+v_after>p_starts_at-v_before)
  or exists(select 1 from public.rdv_booking_holds h where h.practitioner_id=p_practitioner_id
    and (h.status in ('payment_capturing','payment_captured') or (h.status='payment_pending' and h.expires_at>now()))
    and h.starts_at-v_before<p_ends_at+v_after and h.ends_at+v_after>p_starts_at-v_before) then
    return jsonb_build_object('ok',false,'error','slot_unavailable');
  end if;
  if v_practitioner.max_per_day is not null then
    select count(*) into v_count from (
      select b.starts_at from public.bookings b where b.practitioner_id=p_practitioner_id and b.status='confirmed'
        and (b.starts_at at time zone 'Europe/Paris')::date=(p_starts_at at time zone 'Europe/Paris')::date
      union all
      select h.starts_at from public.rdv_booking_holds h where h.practitioner_id=p_practitioner_id
        and (h.status in ('payment_capturing','payment_captured') or (h.status='payment_pending' and h.expires_at>now()))
        and (h.starts_at at time zone 'Europe/Paris')::date=(p_starts_at at time zone 'Europe/Paris')::date
    ) occupied;
    if v_count>=v_practitioner.max_per_day then return jsonb_build_object('ok',false,'error','daily_limit_reached'); end if;
  end if;
  v_amount:=case when p_payment_choice='full_payment' then v_service.price_cents else v_service.reservation_payment_cents end;
  v_expires:=least(now()+interval '72 hours',p_starts_at-interval '24 hours');
  insert into public.rdv_booking_holds(
    practitioner_id,service_id,starts_at,ends_at,selected_modality,video_channel,
    customer_first_name,customer_last_name,customer_email,customer_phone,customer_message,
    service_price_cents,reservation_payment_cents,currency,status,expires_at,
    terms_version,early_performance_requested_at,payment_choice
  ) values (
    p_practitioner_id,p_service_id,p_starts_at,p_ends_at,p_selected_modality,
    case when p_selected_modality='video' then coalesce(p_video_channel,'a_preciser') else null end,
    trim(p_first_name),trim(p_last_name),lower(trim(p_email)),nullif(trim(coalesce(p_phone,'')),''),
    nullif(left(trim(coalesce(p_message,'')),1000),''),
    v_service.price_cents,v_amount,'EUR','payment_pending',v_expires,
    trim(p_terms_version),case when p_early_performance then now() else null end,p_payment_choice
  ) returning id into v_hold_id;
  v_request_id:=gen_random_uuid();
  v_reference:='MDIA-'||upper(left(replace(v_request_id::text,'-',''),12));
  insert into public.rdv_bank_booking_requests(id,hold_id,client_checkout_id,transfer_reference,amount_cents,payment_choice)
    values(v_request_id,v_hold_id,p_client_checkout_id,v_reference,v_amount,p_payment_choice);
  return jsonb_build_object('ok',true,'existing',false,'request_id',v_request_id,
    'reference',v_reference,'expires_at',v_expires,'amount_cents',v_amount,
    'status','pending','price_cents',v_service.price_cents);
end; $$;

create or replace function public.confirm_rdv_bank_booking_request(
  p_actor uuid,p_request_id uuid,p_received_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_bank public.rdv_bank_booking_requests; v_hold public.rdv_booking_holds;
  v_service public.booking_services; v_owner uuid; v_booking uuid;
  v_net integer; v_vat integer; v_before interval;v_after interval;
begin
  select h.practitioner_id into v_owner from public.rdv_bank_booking_requests r
    join public.rdv_booking_holds h on h.id=r.hold_id where r.id=p_request_id;
  if v_owner is null then return jsonb_build_object('ok',false,'error','request_not_found'); end if;
  if not exists(select 1 from public.booking_practitioners where id=v_owner and owner_id=p_actor)
    then return jsonb_build_object('ok',false,'error','forbidden'); end if;
  perform pg_advisory_xact_lock(hashtext(v_owner::text));
  select r.* into v_bank from public.rdv_bank_booking_requests r where r.id=p_request_id for update;
  select h.* into v_hold from public.rdv_booking_holds h where h.id=v_bank.hold_id for update;
  if v_bank.status='confirmed' and v_bank.confirmed_booking_id is not null
    then return jsonb_build_object('ok',true,'already_confirmed',true,'booking_id',v_bank.confirmed_booking_id);
  end if;
  if v_bank.status<>'pending' or v_hold.status<>'payment_pending' or v_hold.expires_at<=now()
    or v_hold.starts_at<=now() then return jsonb_build_object('ok',false,'error','request_expired'); end if;
  if p_received_at is null or p_received_at>now()+interval '1 hour' or p_received_at<v_bank.created_at-interval '1 day'
    then return jsonb_build_object('ok',false,'error','invalid_received_at'); end if;
  select * into v_service from public.booking_services where id=v_hold.service_id;
  select make_interval(mins=>coalesce(buffer_before_min,0)),
         make_interval(mins=>coalesce(buffer_after_min,0))
    into v_before,v_after from public.booking_practitioners where id=v_hold.practitioner_id;
  if exists(select 1 from public.bookings b where b.practitioner_id=v_hold.practitioner_id and b.status='confirmed'
    and b.starts_at-v_before<v_hold.ends_at+v_after and b.ends_at+v_after>v_hold.starts_at-v_before)
    then return jsonb_build_object('ok',false,'error','slot_unavailable'); end if;
  insert into public.bookings (
    practitioner_id,service_id,customer_first_name,customer_last_name,customer_email,
    customer_phone,customer_message,starts_at,ends_at,timezone,status,
    booked_price_cents,reservation_payment_cents,booking_source,modality,video_channel
  ) values(
    v_hold.practitioner_id,v_hold.service_id,v_hold.customer_first_name,v_hold.customer_last_name,
    v_hold.customer_email,v_hold.customer_phone,v_hold.customer_message,
    v_hold.starts_at,v_hold.ends_at,'Europe/Paris','confirmed',
    v_hold.service_price_cents,v_bank.amount_cents,'mediumia',
    v_hold.selected_modality,v_hold.video_channel
  ) returning id into v_booking;
  v_net:=round((v_bank.amount_cents::numeric*10000)/(10000+coalesce(v_service.vat_rate_bps,0)))::integer;
  v_vat:=v_bank.amount_cents-v_net;
  insert into public.rdv_financial_entries (
    practitioner_id,booking_id,service_id,source,entry_kind,direction,payment_method,
    occurred_at,gross_cents,net_cents,vat_cents,vat_rate_bps,vat_status,currency,
    service_price_cents,appointment_starts_at,customer_name,customer_email,external_payment_ref,note
  ) values (
    v_hold.practitioner_id,v_booking,v_hold.service_id,'mediumia',
    case when v_bank.amount_cents>=v_hold.service_price_cents then 'full_payment' else 'arrhes' end,
    'income','transfer',p_received_at,v_bank.amount_cents,v_net,v_vat,
    coalesce(v_service.vat_rate_bps,0),'taxable','EUR',v_hold.service_price_cents,
    v_hold.starts_at,trim(v_hold.customer_first_name||' '||v_hold.customer_last_name),
    v_hold.customer_email,'bank:'||v_bank.transfer_reference,'Virement reçu et confirmé par le praticien'
  );
  update public.rdv_booking_holds set status='converted',expires_at=null,converted_booking_id=v_booking where id=v_hold.id;
  update public.rdv_bank_booking_requests
    set status='confirmed',confirmed_booking_id=v_booking,confirmed_by=p_actor,
    confirmed_at=now(),updated_at=now() where id=v_bank.id;
  return jsonb_build_object('ok',true,'booking_id',v_booking,'amount_cents',v_bank.amount_cents,
    'price_cents',v_hold.service_price_cents,'already_confirmed',false);
end; $$;

create or replace function public.cancel_rdv_bank_booking_request(p_actor uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid;v_bank public.rdv_bank_booking_requests;
begin
 select h.practitioner_id into v_owner from public.rdv_bank_booking_requests r
 join public.rdv_booking_holds h on h.id=r.hold_id where r.id=p_request_id;
 if v_owner is null then return jsonb_build_object('ok',false,'error','not_found');end if;
 if not exists(select 1 from public.booking_practitioners where id=v_owner and owner_id=p_actor)
   then return jsonb_build_object('ok',false,'error','forbidden');end if;
 perform pg_advisory_xact_lock(hashtext(v_owner::text));
 select * into v_bank from public.rdv_bank_booking_requests where id=p_request_id for update;
 if v_bank.status<>'pending' then return jsonb_build_object('ok',false,'error','not_pending');end if;
 update public.rdv_bank_booking_requests set status='cancelled',updated_at=now() where id=p_request_id;
 update public.rdv_booking_holds set status='expired',expires_at=now() where id=v_bank.hold_id and status='payment_pending';
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.create_rdv_bank_booking_request(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function public.confirm_rdv_bank_booking_request(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.cancel_rdv_bank_booking_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_rdv_bank_booking_request(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,uuid,text,text,boolean) to service_role;
grant execute on function public.confirm_rdv_bank_booking_request(uuid,uuid,timestamptz) to service_role;
grant execute on function public.cancel_rdv_bank_booking_request(uuid,uuid) to service_role;
