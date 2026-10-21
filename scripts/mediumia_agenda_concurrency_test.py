#!/usr/bin/env python3
"""Automated, TEST-only PostgreSQL concurrency test for an existing RDV fixture.

The only booking mutation is through rdv_admin_reschedule_booking. The fixture
is restored through that RPC; cleanup deletes only this run's exact history keys.
No fixture is created or deleted by this script.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, time as day_time, timedelta
from urllib.parse import unquote, urlparse
from zoneinfo import ZoneInfo


TEST_REF = "wnbwhnqiulsdjcvkuwos"
FIXTURE_ID = "50385d2d-b312-4335-9d47-2fab4a8613dd"
PRACTITIONER_SLUG = "seb-test"
EMAIL_PREFIX = "qa-interface-conc-"
EMAIL_SUFFIX = "@example.invalid"
PARIS = ZoneInfo("Europe/Paris")
INITIAL_START = datetime(2026, 10, 26, 10, 0, tzinfo=PARIS)
TARGET_STARTS = (
    datetime(2026, 10, 27, 10, 0, tzinfo=PARIS),
    datetime(2026, 10, 28, 10, 0, tzinfo=PARIS),
    datetime(2026, 10, 29, 10, 0, tzinfo=PARIS),
)
EXPECTED_TRIGGERS = {
    "bookings_require_reservation_payment",
    "bookings_upd",
    "guard_owner_cancel_booking_status",
    "guard_owner_cancel_claim_fields",
    "preserve_rdv_balance_token_after_payment",
}
FORBIDDEN_TRIGGER_SOURCE = re.compile(
    r"\b(execute|http|net\.|dblink|pg_notify|google|paypal|resend|smtp|webhook|"
    r"send_email|send_mail|pg_net|pgmq)\b",
    re.IGNORECASE,
)
HISTORY_TABLES = (
    "rdv_booking_action_history",
    "rdv_calendar_sync_jobs",
    "rdv_booking_holds",
    "rdv_balance_payments",
    "rdv_paypal_payments",
    "rdv_financial_entries",
    "rdv_payment_refunds",
    "rdv_deposit_transfers",
    "gift_card_redemptions",
    "booking_slot_offers",
)


class StopTest(RuntimeError):
    """Fail-closed test stop with a non-sensitive diagnostic."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise StopTest(message)


def validate_dsn(dsn: str) -> None:
    """Accept only direct or session-mode TLS PostgreSQL access to TEST."""
    parsed = urlparse(dsn)
    host = (parsed.hostname or "").lower()
    user = unquote(parsed.username or "")
    direct = host == f"db.{TEST_REF}.supabase.co" and user == "postgres" and parsed.port == 5432
    session_pooler = (host.endswith(".pooler.supabase.com")
                      and user == f"postgres.{TEST_REF}" and parsed.port == 5432)
    require(parsed.scheme in ("postgres", "postgresql"), "TEST_DATABASE_URL: schéma invalide")
    require(parsed.path == "/postgres", "TEST_DATABASE_URL: base attendue postgres")
    require(bool(parsed.password), "TEST_DATABASE_URL: authentification absente")
    require(direct or session_pooler,
            "TEST_DATABASE_URL: seul le direct ou le pooler en mode session (port 5432) est autorisé")
    require("uotkpygeqqnekpolezts" not in dsn.lower(), "Référence Production détectée")
    require(parsed.query.lower().find("sslmode=disable") < 0, "TLS ne peut pas être désactivé")


def get_dsn() -> str:
    dsn = os.environ.get("MEDIUMIA_TEST_DATABASE_URL", "")
    require(bool(dsn), "variable MEDIUMIA_TEST_DATABASE_URL absente; ne pas coller de secret dans la conversation")
    validate_dsn(dsn)
    return dsn


def safe_db_error(exc: BaseException) -> str:
    """Do not print driver messages; they may contain connection details."""
    sqlstate = getattr(exc, "sqlstate", None)
    suffix = f" (SQLSTATE {sqlstate})" if sqlstate else ""
    return f"Erreur base {type(exc).__name__}{suffix}; détails masqués."


def make_keys(run_id: str) -> dict[str, str]:
    return {
        "distinct_a": f"qa-conc-{run_id}-distinct-a",
        "distinct_b": f"qa-conc-{run_id}-distinct-b",
        "same": f"qa-conc-{run_id}-same",
        "restore": f"qa-conc-{run_id}-restore",
    }


def check_target_time(start: datetime, duration_min: int, now: datetime) -> datetime:
    require(start.tzinfo is not None, "Créneau sans fuseau horaire")
    end = start + timedelta(minutes=duration_min)
    require(start > now, "Créneau de test déjà passé")
    require(start.astimezone(PARIS).date() == end.astimezone(PARIS).date(), "Créneau traverse minuit à Paris")
    return end


def validate_fixture_payment_fields(payment_kind, reservation_cents, booked_cents) -> None:
    require(payment_kind == "none", "Service TEST inattendu ou avec acompte")
    require(reservation_cents in (None, 0), "Acompte enregistré inattendu")
    require(booked_cents is None or (isinstance(booked_cents, int) and booked_cents >= 0),
            "Prix nominal enregistré invalide")


def self_test() -> None:
    fake_direct = f"postgresql://postgres:dummy@db.{TEST_REF}.supabase.co:5432/postgres?sslmode=require"
    fake_session_pooler = f"postgresql://postgres.{TEST_REF}:dummy@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
    validate_dsn(fake_direct)
    validate_dsn(fake_session_pooler)
    for bad in (
        "postgresql://postgres:dummy@db.uotkpygeqqnekpolezts.supabase.co:5432/postgres?sslmode=require",
        f"postgresql://postgres:dummy@db.{TEST_REF}.supabase.co:5432/postgres?sslmode=disable",
        f"postgresql://postgres:dummy@db.{TEST_REF}.supabase.co:5432/other?sslmode=require",
        f"postgresql://postgres.{TEST_REF}:dummy@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require",
    ):
        try:
            validate_dsn(bad)
        except StopTest:
            pass
        else:
            raise AssertionError("DSN guard accepted an invalid/unsafe endpoint")
    keys = make_keys("0123456789ab")
    require(len(set(keys.values())) == 4, "Idempotency keys must be unique")
    require(all(re.fullmatch(r"[A-Za-z0-9_.:-]{8,160}", key) for key in keys.values()), "Key format rejected")
    validate_fixture_payment_fields("none", 0, 7000)
    for invalid in (("deposit", 0, 7000), ("none", 1500, 7000), ("none", 0, -1)):
        try:
            validate_fixture_payment_fields(*invalid)
        except StopTest:
            pass
        else:
            raise AssertionError("Fixture payment guard accepted an unsafe value")
    require(INITIAL_START.weekday() == 0 and INITIAL_START.hour == 10, "Fixture initial schedule mismatch")
    require([x.day for x in TARGET_STARTS] == [27, 28, 29], "Target dates mismatch")
    print("SELF-TEST PASS: DSN guards, payment-field semantics, exact fixture schedule, target dates, key uniqueness")


def connect(psycopg, dsn: str, label: str):
    # `require` and `validate_dsn` run before any connection attempt.
    return psycopg.connect(
        dsn,
        sslmode="require",
        connect_timeout=12,
        application_name=label[:63],
        autocommit=True,
    )


def fetchone(conn, query: str, params=()):
    with conn.cursor() as cur:
        cur.execute(query, params)
        return cur.fetchone()


def fetchall(conn, query: str, params=()):
    with conn.cursor() as cur:
        cur.execute(query, params)
        return cur.fetchall()


def in_transaction(conn, owner_id: str, booking_id: str, version: datetime,
                    starts_at: datetime, ends_at: datetime, key: str):
    with conn.cursor() as cur:
        cur.execute("SELECT set_config('request.jwt.claim.role', 'service_role', true)")
        cur.fetchone()
        cur.execute("SELECT auth.role()::text")
        role = cur.fetchone()[0]
        require(role == "service_role", "La revendication service_role ne fonctionne pas sur TEST")
        cur.execute(
            "SELECT public.rdv_admin_reschedule_booking(%s::uuid,%s::uuid,%s::timestamptz,"
            "%s::timestamptz,%s::timestamptz,%s::text)",
            (owner_id, booking_id, version, starts_at, ends_at, key),
        )
        return cur.fetchone()[0]


def verify_triggers(conn) -> None:
    rows = fetchall(conn, """
        SELECT t.tgname, p.proname, pg_get_functiondef(t.tgfoid)
        FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_proc p ON p.oid=t.tgfoid
        WHERE n.nspname='public' AND c.relname='bookings'
          AND NOT t.tgisinternal AND t.tgenabled <> 'D'
        ORDER BY t.tgname
    """)
    names = {row[0] for row in rows}
    require(names == EXPECTED_TRIGGERS, "Trigger bookings différent du jeu audité; arrêt préventif")
    for name, _function, definition in rows:
        require(not FORBIDDEN_TRIGGER_SOURCE.search(definition or ""),
                f"Le trigger {name} contient une primitive externe/dynamique; arrêt")


def fixture_snapshot(conn, expected_email_pattern: bool = True):
    row = fetchone(conn, """
        SELECT b.id::text, b.practitioner_id::text, p.slug, p.owner_id::text,
               b.service_id::text, b.customer_email, b.status, b.booking_source,
               b.starts_at, b.ends_at, b.updated_at, b.google_event_id,
               b.reservation_payment_cents, b.booked_price_cents,
               s.duration_min, s.reservation_payment_kind,
               p.buffer_before_min, p.buffer_after_min, p.max_per_day,
               p.min_advance_hours, p.booking_horizon_days
        FROM public.bookings b
        JOIN public.booking_practitioners p ON p.id=b.practitioner_id
        JOIN public.booking_services s ON s.id=b.service_id
        WHERE b.id=%s::uuid
    """, (FIXTURE_ID,))
    require(row is not None, "Fixture introuvable dans le projet TEST")
    (booking_id, practitioner_id, slug, owner_id, service_id, email, status,
     source, starts, ends, updated, google_id, reservation_cents, booked_cents,
     duration, payment_kind, before, after, max_per_day, min_advance, horizon) = row
    require(booking_id == FIXTURE_ID, "Booking ID inattendu")
    require(slug == PRACTITIONER_SLUG, "Praticien fixture inattendu")
    require(email.startswith(EMAIL_PREFIX) and email.endswith(EMAIL_SUFFIX), "Adresse fixture non synthétique")
    require(status == "confirmed" and source == "mediumia", "Fixture non déplaçable selon les préconditions")
    require(google_id is None, "Fixture associée à Google Calendar")
    require(duration == 60, "Durée du service TEST inattendue")
    validate_fixture_payment_fields(payment_kind, reservation_cents, booked_cents)
    require(starts == INITIAL_START and ends == INITIAL_START + timedelta(hours=1),
            "Horaire initial différent du créneau confirmé")
    if expected_email_pattern:
        require(re.fullmatch(re.escape(EMAIL_PREFIX) + r"[^@]+" + re.escape(EMAIL_SUFFIX), email) is not None,
                "Adresse synthétique fixture invalide")
    return {
        "booking_id": booking_id, "practitioner_id": practitioner_id,
        "owner_id": owner_id, "service_id": service_id, "starts_at": starts,
        "ends_at": ends, "updated_at": updated, "duration_min": duration,
        "buffer_before_min": before or 0, "buffer_after_min": after or 0,
        "max_per_day": max_per_day, "min_advance_hours": min_advance or 0,
        "booking_horizon_days": horizon or 370,
    }


def preflight_dependencies(conn, snapshot: dict, keys: dict[str, str]) -> None:
    required = ["bookings", "booking_practitioners", "booking_services",
                "booking_availability_rules", "booking_exceptions", *HISTORY_TABLES]
    for table in required:
        present = fetchone(conn, "SELECT to_regclass(%s) IS NOT NULL", (f"public.{table}",))[0]
        require(present, f"Table TEST requise absente: {table}")
    rpc_exists = fetchone(conn, """
        SELECT to_regprocedure('public.rdv_admin_reschedule_booking(uuid,uuid,timestamptz,timestamptz,timestamptz,text)') IS NOT NULL
    """)[0]
    require(rpc_exists, "RPC de replanification absente; aucune migration automatique")

    counts = fetchone(conn, """
        SELECT
          (SELECT count(*) FROM public.rdv_booking_action_history WHERE booking_id=%s::uuid),
          (SELECT count(*) FROM public.rdv_calendar_sync_jobs WHERE booking_id=%s::uuid),
          (SELECT count(*) FROM public.rdv_booking_holds WHERE converted_booking_id=%s::uuid),
          (SELECT count(*) FROM public.rdv_balance_payments WHERE booking_id=%s::uuid),
          (SELECT count(*) FROM public.rdv_paypal_payments pp
             JOIN public.rdv_booking_holds h ON h.id=pp.hold_id WHERE h.converted_booking_id=%s::uuid),
          (SELECT count(*) FROM public.rdv_financial_entries WHERE booking_id=%s::uuid),
          (SELECT count(*) FROM public.rdv_payment_refunds WHERE booking_id=%s::uuid),
          (SELECT count(*) FROM public.rdv_deposit_transfers WHERE source_booking_id=%s::uuid OR target_booking_id=%s::uuid),
          (SELECT count(*) FROM public.gift_card_redemptions WHERE booking_id=%s::uuid),
          (SELECT count(*) FROM public.booking_slot_offers WHERE used_booking_id=%s::uuid)
    """, (FIXTURE_ID, FIXTURE_ID, FIXTURE_ID, FIXTURE_ID, FIXTURE_ID,
          FIXTURE_ID, FIXTURE_ID, FIXTURE_ID, FIXTURE_ID, FIXTURE_ID))
    require(counts == (0,) * 10,
            "Fixture a un historique, paiement, hold, offre ou job Google préexistant; aucune mutation lancée")
    collisions = fetchone(conn, """
        SELECT count(*) FROM public.rdv_booking_action_history
        WHERE actor_id=%s::uuid AND idempotency_key = ANY(%s::text[])
    """, (snapshot["owner_id"], list(keys.values())))[0]
    require(collisions == 0, "Collision d'idempotence; aucune mutation lancée")


def slot_is_available(conn, snapshot: dict, start: datetime, now: datetime) -> None:
    end = check_target_time(start, snapshot["duration_min"], now)
    local_start = start.astimezone(PARIS)
    local_end = end.astimezone(PARIS)
    require(start >= now + timedelta(hours=snapshot["min_advance_hours"]), "Créneau trop proche")
    require(start <= now + timedelta(days=snapshot["booking_horizon_days"]), "Créneau hors horizon")
    exception = fetchone(conn, """
        SELECT exception_type, slots FROM public.booking_exceptions
        WHERE practitioner_id=%s::uuid AND exception_date=%s
    """, (snapshot["practitioner_id"], local_start.date()))
    fits = False
    if exception and exception[0] == "closed":
        fits = False
    elif exception and exception[0] == "modified":
        slots = exception[1] or []
        for slot in slots:
            try:
                slot_start = day_time.fromisoformat(slot["start_time"])
                slot_end = day_time.fromisoformat(slot["end_time"])
            except (KeyError, TypeError, ValueError):
                continue
            offset = (local_start.time().replace(tzinfo=None).hour * 3600
                      + local_start.time().replace(tzinfo=None).minute * 60
                      - (slot_start.hour * 3600 + slot_start.minute * 60))
            if (local_start.time().replace(tzinfo=None) >= slot_start
                    and local_end.time().replace(tzinfo=None) <= slot_end
                    and offset >= 0 and offset % (snapshot["duration_min"] * 60) == 0):
                fits = True
                break
    else:
        rules = fetchall(conn, """
            SELECT start_time, end_time FROM public.booking_availability_rules
            WHERE practitioner_id=%s::uuid AND day_of_week=%s
        """, (snapshot["practitioner_id"], local_start.isoweekday() - 1))
        for rule_start, rule_end in rules:
            local_time = local_start.time().replace(tzinfo=None)
            end_time = local_end.time().replace(tzinfo=None)
            offset = ((local_time.hour - rule_start.hour) * 3600
                      + (local_time.minute - rule_start.minute) * 60
                      + (local_time.second - rule_start.second))
            if local_time >= rule_start and end_time <= rule_end and offset >= 0 and offset % (snapshot["duration_min"] * 60) == 0:
                fits = True
                break
    require(fits, f"Créneau non couvert par les règles TEST: {local_start.date()}")

    before = snapshot["buffer_before_min"]
    after = snapshot["buffer_after_min"]
    occupied = fetchone(conn, """
        SELECT
          EXISTS (SELECT 1 FROM public.bookings b
            WHERE b.practitioner_id=%s::uuid AND b.id<>%s::uuid AND b.status='confirmed'
              AND (b.starts_at - make_interval(mins=>%s)) < (%s::timestamptz + make_interval(mins=>%s))
              AND (b.ends_at + make_interval(mins=>%s)) > (%s::timestamptz - make_interval(mins=>%s)))
          OR EXISTS (SELECT 1 FROM public.rdv_booking_holds h
            WHERE h.practitioner_id=%s::uuid
              AND (h.status IN ('payment_capturing','payment_captured') OR (h.status='payment_pending' AND h.expires_at>clock_timestamp()))
              AND (h.starts_at - make_interval(mins=>%s)) < (%s::timestamptz + make_interval(mins=>%s))
              AND (h.ends_at + make_interval(mins=>%s)) > (%s::timestamptz - make_interval(mins=>%s)))
          OR EXISTS (SELECT 1 FROM public.booking_slot_offers o
            WHERE o.practitioner_id=%s::uuid AND o.status='open' AND o.expires_at>clock_timestamp()
              AND (o.starts_at - make_interval(mins=>%s)) < (%s::timestamptz + make_interval(mins=>%s))
              AND (o.ends_at + make_interval(mins=>%s)) > (%s::timestamptz - make_interval(mins=>%s)))
    """, (snapshot["practitioner_id"], FIXTURE_ID, before, start, after, after, start, before,
          snapshot["practitioner_id"], before, start, after, after, start, before,
          snapshot["practitioner_id"], before, start, after, after, start, before))[0]
    require(not occupied, f"Collision de créneau, hold ou offre: {local_start.date()}")

    if snapshot["max_per_day"] is not None:
        local_midnight = datetime.combine(local_start.date(), day_time.min, tzinfo=PARIS)
        next_midnight = local_midnight + timedelta(days=1)
        count = fetchone(conn, """
            SELECT
              (SELECT count(*) FROM public.bookings b WHERE b.practitioner_id=%s::uuid
                AND b.status='confirmed' AND b.id<>%s::uuid
                AND b.starts_at >= %s::timestamptz AND b.starts_at < %s::timestamptz)
              + (SELECT count(*) FROM public.rdv_booking_holds h WHERE h.practitioner_id=%s::uuid
                AND (h.status IN ('payment_capturing','payment_captured') OR (h.status='payment_pending' AND h.expires_at>clock_timestamp()))
                AND h.starts_at >= %s::timestamptz AND h.starts_at < %s::timestamptz)
        """, (snapshot["practitioner_id"], FIXTURE_ID, local_midnight, next_midnight,
              snapshot["practitioner_id"], local_midnight, next_midnight))[0]
        require(count < snapshot["max_per_day"], f"Limite quotidienne atteinte: {local_start.date()}")


def observe_block(conn, a_label: str, b_label: str, a_pid: int, b_pid: int,
                  timeout_seconds: float = 12.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        rows = fetchall(conn, """
            SELECT pid, application_name, state, wait_event_type, pg_blocking_pids(pid)
            FROM pg_stat_activity
            WHERE application_name IN (%s, %s)
        """, (a_label, b_label))
        by_label = {row[1]: row for row in rows}
        a = by_label.get(a_label)
        b = by_label.get(b_label)
        if (a and b and a[0] == a_pid and b[0] == b_pid and a_pid != b_pid
                and b[2] == "active" and b[3] == "Lock" and a_pid in (b[4] or [])):
            return
        time.sleep(0.08)
    raise StopTest("Blocage non prouvé par pg_blocking_pids avant expiration")


def begin_rpc(conn, owner_id, version, start, end, key):
    conn.execute("BEGIN")
    try:
        result = in_transaction(conn, owner_id, FIXTURE_ID, version, start, end, key)
        return result
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def run_race(psycopg, dsn, observer, run_id, label, owner_id, snapshot,
             version, target_a, target_b, key_a, key_b, same_key):
    a_label = f"ma-conc-{run_id}-{label}-A"
    b_label = f"ma-conc-{run_id}-{label}-B"
    a = connect(psycopg, dsn, a_label)
    b = connect(psycopg, dsn, b_label)
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"agenda-{label}")
    future: Future | None = None
    a_open = False
    b_open = False
    try:
        pid_a = fetchone(a, "SELECT pg_backend_pid()")[0]
        pid_b = fetchone(b, "SELECT pg_backend_pid()")[0]
        pid_c = fetchone(observer, "SELECT pg_backend_pid()")[0]
        require(len({pid_a, pid_b, pid_c}) == 3,
                "A, B et l'observateur C doivent être trois backends PostgreSQL distincts")
        result_a = begin_rpc(a, owner_id, version, target_a, target_a + timedelta(minutes=snapshot["duration_min"]), key_a)
        a_open = True
        require(isinstance(result_a, dict) and result_a.get("ok") is True,
                f"RPC A refusée ({label}); aucune validation de concurrence")

        def call_b():
            b.execute("BEGIN")
            try:
                result = in_transaction(
                    b, owner_id, FIXTURE_ID, version, target_b,
                    target_b + timedelta(minutes=snapshot["duration_min"]), key_b,
                )
                return result
            except BaseException:
                b.execute("ROLLBACK")
                raise

        future = pool.submit(call_b)
        observe_block(observer, a_label, b_label, pid_a, pid_b)

        # Only A commits after the third connection has proven B is waiting on A.
        a.execute("COMMIT")
        a_open = False
        result_b = future.result(timeout=20)
        b_open = True
        if same_key:
            require(isinstance(result_b, dict) and result_b.get("ok") is True
                    and result_b.get("idempotent") is True,
                    "Le rejeu concurrent n'a pas retourné idempotent:true")
        else:
            require(isinstance(result_b, dict) and result_b.get("ok") is False
                    and result_b.get("error") == "booking_changed",
                    "La requête perdante n'a pas été rejetée booking_changed")
        b.execute("COMMIT")
        b_open = False
        return {"label": label, "pids_distinct": True, "block_proven": True,
                "result_a": result_a, "result_b": result_b}
    except BaseException:
        # Keep B's mutation uncommitted until observation; abort it before releasing A.
        if future is not None and not future.done():
            try:
                b.cancel()
            except Exception:
                pass
        if a_open:
            try:
                a.execute("ROLLBACK")
                a_open = False
            except Exception:
                pass
        if future is not None and not future.done():
            try:
                future.result(timeout=10)
            except BaseException:
                pass
        try:
            b.execute("ROLLBACK")
        except Exception:
            pass
        raise
    finally:
        if b_open:
            try:
                b.execute("ROLLBACK")
            except Exception:
                pass
        if a_open:
            try:
                a.execute("ROLLBACK")
            except Exception:
                pass
        pool.shutdown(wait=True, cancel_futures=True)
        a.close()
        b.close()


def current_state(conn, snapshot):
    return fetchone(conn, """
        SELECT starts_at, ends_at, updated_at, google_event_id,
          (SELECT count(*) FROM public.rdv_calendar_sync_jobs WHERE booking_id=%s::uuid),
          (SELECT count(*) FROM public.rdv_balance_payments WHERE booking_id=%s::uuid),
          (SELECT count(*) FROM public.rdv_booking_holds WHERE converted_booking_id=%s::uuid)
        FROM public.bookings WHERE id=%s::uuid AND practitioner_id=%s::uuid
    """, (FIXTURE_ID, FIXTURE_ID, FIXTURE_ID, FIXTURE_ID, snapshot["practitioner_id"]))


def restore_and_clean(psycopg, dsn, run_id, snapshot, keys, baseline_start, baseline_end,
                      owned_versions: set[datetime]) -> bool:
    cleanup_label = f"ma-conc-{run_id}-cleanup"
    conn = connect(psycopg, dsn, cleanup_label)
    try:
        state = current_state(conn, snapshot)
        require(state is not None, "Fixture a disparu; nettoyage interdit")
        starts, ends, version, google_id, google_jobs, balance_rows, holds = state
        require(google_id is None and google_jobs == 0 and balance_rows == 0 and holds == 0,
                "Un lien Google/paiement/hold inattendu existe; historique conservé pour inspection")
        if (starts, ends) != (baseline_start, baseline_end):
            require(version in owned_versions,
                    "La version courante n'appartient pas à ce test; aucune restauration automatique")
            require((starts, ends) in {
                (TARGET_STARTS[0], TARGET_STARTS[0] + timedelta(minutes=snapshot["duration_min"])),
                (TARGET_STARTS[1], TARGET_STARTS[1] + timedelta(minutes=snapshot["duration_min"])),
                (TARGET_STARTS[2], TARGET_STARTS[2] + timedelta(minutes=snapshot["duration_min"])),
            }, "Horaire courant non attribuable à ce test; aucune restauration automatique")
            conn.execute("BEGIN")
            result = in_transaction(conn, snapshot["owner_id"], FIXTURE_ID, version,
                                    baseline_start, baseline_end, keys["restore"])
            require(isinstance(result, dict) and result.get("ok") is True,
                    "Restauration via RPC refusée; fixture conservée pour récupération contrôlée")
            conn.execute("COMMIT")
        state = current_state(conn, snapshot)
        require(state is not None and state[0] == baseline_start and state[1] == baseline_end,
                "Horaire initial non restauré; historique conservé")
        require(state[3] is None and state[4] == 0 and state[5] == 0 and state[6] == 0,
                "Un lien externe/financier est apparu; historique conservé")

        history = fetchall(conn, """
            SELECT id::text, idempotency_key, previous_starts_at, previous_ends_at,
                   next_starts_at, next_ends_at
            FROM public.rdv_booking_action_history
            WHERE booking_id=%s::uuid AND actor_id=%s::uuid
              AND idempotency_key = ANY(%s::text[])
            ORDER BY idempotency_key
        """, (FIXTURE_ID, snapshot["owner_id"], list(keys.values())))
        allowed = set(keys.values())
        require(all(row[1] in allowed for row in history), "Historique contient une clé hors de ce run")
        # Distinct-B is intentionally a loser and must never have a history row.
        require(not any(row[1] == keys["distinct_b"] for row in history),
                "La requête distincte perdante a créé un historique")
        # Delete only exact keys, for this fixture and owner; never touch the booking.
        if history:
            with conn.transaction():
                deleted = fetchone(conn, """
                    WITH removed AS (
                      DELETE FROM public.rdv_booking_action_history
                      WHERE booking_id=%s::uuid AND actor_id=%s::uuid
                        AND idempotency_key = ANY(%s::text[])
                      RETURNING id
                    ) SELECT count(*) FROM removed
                """, (FIXTURE_ID, snapshot["owner_id"], list(keys.values())))[0]
                require(deleted == len(history), "Nombre d'historiques supprimés différent du relevé exact")
        left = fetchone(conn, """
            SELECT count(*) FROM public.rdv_booking_action_history
            WHERE booking_id=%s::uuid AND actor_id=%s::uuid AND idempotency_key = ANY(%s::text[])
        """, (FIXTURE_ID, snapshot["owner_id"], list(keys.values())))[0]
        require(left == 0, "Nettoyage exact de l'historique incomplet")
        return True
    finally:
        conn.close()


def run_read_only_preflight() -> int:
    dsn = get_dsn()
    try:
        import psycopg  # type: ignore[import-not-found]
    except ImportError as exc:
        raise StopTest("psycopg v3 absent; installer uniquement dans un environnement temporaire hors dépôt") from exc
    run_id = uuid.uuid4().hex[:12]
    conn = connect(psycopg, dsn, f"ma-conc-{run_id}-preflight")
    try:
        identity = fetchone(conn, "SELECT current_database(), current_user, auth.role()::text")
        require(identity[0] == "postgres" and identity[1] == "postgres",
                "Connexion TEST doit être la base postgres et le rôle postgres; aucun secret affiché")
        require(identity[2] in (None, ""), "Connexion de contrôle porte un rôle JWT inattendu")
        verify_triggers(conn)
        snapshot = fixture_snapshot(conn)
        keys = make_keys(run_id)
        preflight_dependencies(conn, snapshot, keys)
        now = fetchone(conn, "SELECT clock_timestamp()")[0]
        for target in TARGET_STARTS:
            slot_is_available(conn, snapshot, target, now)
        slot_is_available(conn, snapshot, snapshot["starts_at"], now)
        print("READ-ONLY PREFLIGHT: PASS")
        print("- Projet TEST et rôle PostgreSQL vérifiés; TLS forcé; connexion directe/session, non transactionnelle.")
        print("- Fixture, updated_at courant, absence de dépendances financières/Google/historique et créneaux contrôlés.")
        print("- Aucune RPC de déplacement, écriture, transaction métier ou nettoyage exécuté.")
        return 0
    finally:
        conn.close()


def run_test() -> int:
    dsn = get_dsn()
    try:
        import psycopg  # type: ignore[import-not-found]
    except ImportError as exc:
        raise StopTest("psycopg v3 absent; installer uniquement dans un environnement temporaire hors dépôt") from exc

    run_id = uuid.uuid4().hex[:12]
    keys = make_keys(run_id)
    setup = observer = None
    snapshot = None
    baseline_start = INITIAL_START
    baseline_end = INITIAL_START + timedelta(hours=1)
    passed = False
    cleanup_ok = False
    diagnostics: list[str] = []
    owned_versions: set[datetime] = set()
    try:
        setup = connect(psycopg, dsn, f"ma-conc-{run_id}-setup")
        observer = connect(psycopg, dsn, f"ma-conc-{run_id}-observer")
        identity = fetchone(setup, "SELECT current_database(), current_user, auth.role()::text")
        require(identity[0] == "postgres" and identity[1] == "postgres",
                "Connexion TEST doit être la base postgres et le rôle postgres; aucun secret affiché")
        require(identity[2] in (None, ""), "Connexion de contrôle déjà porteuse d'un rôle JWT inattendu")
        pids = {fetchone(c, "SELECT pg_backend_pid()")[0] for c in (setup, observer)}
        require(len(pids) == 2, "Connexions de contrôle non indépendantes")
        verify_triggers(setup)
        snapshot = fixture_snapshot(setup)
        # The real updated_at is read here at the start of the execution; never embedded in code.
        baseline_start, baseline_end = snapshot["starts_at"], snapshot["ends_at"]
        owned_versions.add(snapshot["updated_at"])
        preflight_dependencies(setup, snapshot, keys)
        now = fetchone(setup, "SELECT clock_timestamp()")[0]
        for target in TARGET_STARTS:
            slot_is_available(setup, snapshot, target, now)
        slot_is_available(setup, snapshot, baseline_start, now)
        diagnostics.append("TEST identity, fixture, no financial/Google/history dependencies and four slots verified")

        first = run_race(psycopg, dsn, observer, run_id, "different", snapshot["owner_id"], snapshot,
                         snapshot["updated_at"], TARGET_STARTS[0], TARGET_STARTS[1],
                         keys["distinct_a"], keys["distinct_b"], False)
        diagnostics.append("Race 1: distinct PIDs, pg_blocking_pids proven, loser booking_changed")
        state = current_state(setup, snapshot)
        require(state and state[0] == TARGET_STARTS[0], "Race 1 final slot differs from winner A")
        owned_versions.add(state[2])
        count = fetchone(setup, """
            SELECT count(*) FROM public.rdv_booking_action_history
            WHERE booking_id=%s::uuid AND actor_id=%s::uuid AND idempotency_key=%s
        """, (FIXTURE_ID, snapshot["owner_id"], keys["distinct_a"]))[0]
        require(count == 1, "Race 1 must create one winner history row")
        count_loser = fetchone(setup, """
            SELECT count(*) FROM public.rdv_booking_action_history
            WHERE booking_id=%s::uuid AND actor_id=%s::uuid AND idempotency_key=%s
        """, (FIXTURE_ID, snapshot["owner_id"], keys["distinct_b"]))[0]
        require(count_loser == 0, "Race 1 loser unexpectedly wrote history")

        version_2 = state[2]
        second = run_race(psycopg, dsn, observer, run_id, "same", snapshot["owner_id"], snapshot,
                          version_2, TARGET_STARTS[2], TARGET_STARTS[2],
                          keys["same"], keys["same"], True)
        diagnostics.append("Race 2: distinct PIDs, pg_blocking_pids proven, replay idempotent:true")
        state = current_state(setup, snapshot)
        require(state and state[0] == TARGET_STARTS[2], "Race 2 final slot differs from request")
        owned_versions.add(state[2])
        count = fetchone(setup, """
            SELECT count(*) FROM public.rdv_booking_action_history
            WHERE booking_id=%s::uuid AND actor_id=%s::uuid AND idempotency_key=%s
        """, (FIXTURE_ID, snapshot["owner_id"], keys["same"]))[0]
        require(count == 1, "Race 2 idempotent replay created duplicate history")
        passed = True
    except StopTest as exc:
        diagnostics.append(f"STOP: {exc}")
    except BaseException as exc:
        diagnostics.append(f"STOP: {safe_db_error(exc)}")
    finally:
        if setup is not None and snapshot is not None:
            try:
                # Close the observer before recovery so no stale observer session remains.
                if observer is not None:
                    observer.close()
                    observer = None
                cleanup_ok = restore_and_clean(psycopg, dsn, run_id, snapshot, keys,
                                               baseline_start, baseline_end, owned_versions)
                diagnostics.append("Cleanup: original slot restored through RPC; exact run histories removed; fixture retained")
            except StopTest as exc:
                diagnostics.append(f"STOP nettoyage: {exc}")
            except BaseException as exc:
                diagnostics.append(f"STOP nettoyage: {safe_db_error(exc)}")
        for conn in (observer, setup):
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    if passed and cleanup_ok:
        print("CONCURRENCE TEST: PASS")
        for item in diagnostics:
            print(f"- {item}")
        return 0
    print("CONCURRENCE TEST: STOP")
    for item in diagnostics:
        print(f"- {item}")
    if not cleanup_ok and snapshot is not None:
        print("- Fixture conservée; vérifier TEST et effectuer une récupération contrôlée avant tout nouvel essai.")
    return 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--self-test", action="store_true", help="Contrôles locaux sans réseau ni base")
    group.add_argument("--preflight-only", action="store_true", help="Contrôles distants strictement en lecture seule")
    group.add_argument("--execute-test-only", action="store_true", help="Exécuter contre Supabase TEST uniquement")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if args.preflight_only:
        return run_read_only_preflight()
    if args.execute_test_only:
        return run_test()
    parser.print_help()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except StopTest as exc:
        print(f"STOP: {exc}", file=sys.stderr)
        sys.exit(2)
