-- Base de TEST uniquement (wnbwhnqiulsdjcvkuwos). Lecture seule.
-- Remplacer ADRESSE_DE_TEST par l'adresse de la réservation de test.

-- A. Rendez-vous de test et paiement PayPal
with t as (select lower('ADRESSE_DE_TEST') as email)
select b.id as booking_id, b.status, b.cancel_reason, b.starts_at,
       p.paypal_env, p.status as payment_status, p.amount_cents, p.paypal_capture_id,
       p.settlement_status, p.refunded_cents
from public.bookings b
join public.rdv_booking_holds h on h.converted_booking_id = b.id
join public.rdv_paypal_payments p on p.hold_id = h.id
join t on lower(b.customer_email) = t.email
order by b.starts_at desc;

-- B. Demandes de remboursement (attendu : une seule ligne, completed)
with t as (select lower('ADRESSE_DE_TEST') as email)
select r.status, r.amount_cents, r.paypal_env, r.paypal_refund_id, r.paypal_request_id,
       r.attempt_count, r.error_code, r.adopted_external, r.requested_at, r.completed_at
from public.rdv_payment_refunds r
join public.bookings b on b.id = r.booking_id
join t on lower(b.customer_email) = t.email
order by r.requested_at;

-- C. Comptabilité : encaissement intact + contre-écriture (total attendu : 0)
with t as (select lower('ADRESSE_DE_TEST') as email)
select e.entry_kind, e.direction, e.gross_cents, e.net_cents, e.vat_cents,
       e.external_payment_ref, e.occurred_at
from public.rdv_financial_entries e
join public.bookings b on b.id = e.booking_id
join t on lower(b.customer_email) = t.email
order by e.occurred_at;

with t as (select lower('ADRESSE_DE_TEST') as email)
select count(*) filter (where e.direction = 'income') as encaissements,
       count(*) filter (where e.direction = 'refund') as remboursements,
       sum(case e.direction when 'income' then e.gross_cents else -e.gross_cents end) as total_cents
from public.rdv_financial_entries e
join public.bookings b on b.id = e.booking_id
join t on lower(b.customer_email) = t.email;

-- D. Journal d'audit
with t as (select lower('ADRESSE_DE_TEST') as email)
select ev.event, ev.detail, ev.created_at
from public.rdv_payment_settlement_events ev
join public.rdv_paypal_payments p on p.id = ev.payment_id
join public.rdv_booking_holds h on h.id = p.hold_id
join public.bookings b on b.id = h.converted_booking_id
join t on lower(b.customer_email) = t.email
order by ev.id;
