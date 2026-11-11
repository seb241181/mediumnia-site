-- Espace client MediumIA — lecture des rendez-vous d'un compte (lot 1).
--
-- Renvoie uniquement les rendez-vous réservés avec une adresse VÉRIFIÉE du
-- compte, et uniquement une liste blanche de champs : jamais les notes du
-- praticien, les décisions internes sur le solde, les références PayPal ni
-- l'ancien lien Meet.
--
-- Montants : écritures réelles de rdv_financial_entries (même règle que
-- rdv_booking_paid_cents : source « mediumia »). Un paiement PayPal non
-- capturé n'est jamais compté ; il est seulement signalé « en attente ».
--
-- Réservée au serveur (service_role). Rejouable.
-- Dépend de 20261111100000 et 20261111101000.

create index if not exists idx_bookings_customer_email_normalized
  on public.bookings (lower(btrim(customer_email)));

create or replace function public.mediumia_account_bookings(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with emails as (
    select e.email from public.mediumia_account_emails e where e.user_id = p_user_id
  ),
  mine as (
    select b.*
    from public.bookings b
    where p_user_id is not null
      and lower(btrim(b.customer_email)) in (select email from emails)
  ),
  shaped as (
    select
      m.id,
      m.starts_at,
      coalesce(
        m.modality,
        h.selected_modality,
        case when r.requested_modality in ('video', 'in-person') then r.requested_modality end,
        case when cardinality(s.modality) = 1 and s.modality[1] in ('video', 'in-person') then s.modality[1] end
      ) as modality,
      nullif(coalesce(m.video_channel, h.video_channel, r.video_channel), 'a_preciser') as video_channel,
      coalesce(m.booked_price_cents, h.service_price_cents) as price_cents,
      jsonb_build_object(
        'id', m.id,
        'starts_at', m.starts_at,
        'ends_at', m.ends_at,
        'timezone', m.timezone,
        'status', m.status,
        'cancelled_at', m.cancelled_at,
        'cancel_origin', case
          when m.status <> 'cancelled' then null
          when m.cancel_reason = 'client_self_service' then 'client'
          when m.cancel_reason = 'balance_unpaid_48h' then 'unpaid_balance'
          else 'other'
        end,
        'service_title', s.title,
        'duration_min', s.duration_min,
        'practitioner_name', p.name,
        'customer_first_name', m.customer_first_name,
        'customer_last_name', m.customer_last_name,
        'customer_phone', m.customer_phone,
        'paid_cents', public.rdv_booking_paid_cents(m.id),
        'payment_pending', exists (
          select 1 from public.rdv_balance_payments bp
          where bp.booking_id = m.id and bp.status in ('order_pending', 'capture_in_progress')
        ),
        'entries', coalesce((
          select jsonb_agg(jsonb_build_object(
            'kind', e.entry_kind,
            'direction', e.direction,
            'method', e.payment_method,
            'occurred_at', e.occurred_at,
            'gross_cents', e.gross_cents
          ) order by e.occurred_at, e.created_at)
          from public.rdv_financial_entries e
          where e.booking_id = m.id and e.source = 'mediumia'
        ), '[]'::jsonb)
      ) as base
    from mine m
    join public.booking_services s on s.id = m.service_id
    join public.booking_practitioners p on p.id = m.practitioner_id
    left join lateral (
      select hh.selected_modality, hh.video_channel, hh.service_price_cents
      from public.rdv_booking_holds hh
      where hh.converted_booking_id = m.id
      order by hh.created_at desc
      limit 1
    ) h on true
    left join lateral (
      select rr.requested_modality, rr.video_channel
      from public.booking_requests rr
      where rr.confirmed_booking_id = m.id
      order by rr.created_at desc
      limit 1
    ) r on true
  )
  select coalesce(jsonb_agg(
    base || jsonb_build_object(
      'modality', modality,
      'video_channel', case when modality = 'video' then video_channel end,
      'price_cents', price_cents
    )
    order by starts_at
  ), '[]'::jsonb)
  from shaped;
$$;

revoke all on function public.mediumia_account_bookings(uuid) from public, anon, authenticated;
grant execute on function public.mediumia_account_bookings(uuid) to service_role;
