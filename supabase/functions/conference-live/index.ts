import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://mediumia.fr", "https://www.mediumia.fr"]);
const DEFAULT_SLUG = "premiere-conference-mediumia";

function clean(value: unknown, max = 600) {
  return String(value ?? "").trim().slice(0, max);
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.has(origin) || /^https:\/\/[^/]+\.vercel\.app$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://mediumia.fr",
    "Access-Control-Allow-Headers": "content-type,authorization,x-conference-access",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function liveWindow(event: any) {
  const now = Date.now();
  const start = event?.starts_at ? new Date(event.starts_at).getTime() : NaN;
  const end = event?.ends_at ? new Date(event.ends_at).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return now >= start - 30 * 60_000 && now <= end + 15 * 60_000;
}

function questionsWindow(event: any) {
  if (isTestProject()) return true;
  const now = Date.now();
  const start = event?.starts_at ? new Date(event.starts_at).getTime() : NaN;
  const end = event?.ends_at ? new Date(event.ends_at).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return now >= start - 30 * 60_000 && now <= end + 30 * 60_000;
}

async function getEvent(supabase: any, slug: string) {
  const { data, error } = await supabase
    .from("conference_events")
    .select("id,slug,title,subtitle,starts_at,ends_at,timezone,status")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getParticipant(supabase: any, eventId: string, req: Request) {
  const raw = clean(req.headers.get("x-conference-access"), 300);
  if (!raw) return null;
  const hash = await sha256Hex(raw);
  const { data, error } = await supabase
    .from("conference_registrations")
    .select("id,first_name,status,attended_at,live_last_seen_at")
    .eq("event_id", eventId)
    .eq("live_access_token_hash", hash)
    .maybeSingle();
  if (error || !data || data.status === "cancelled") return null;
  return data;
}

async function requireAdmin(supabase: any, req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  const { data: admin } = await supabase
    .from("conference_admins")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  return admin ? data.user : null;
}

async function touchPresence(supabase: any, registration: any, event: any) {
  const now = new Date().toISOString();
  const patch: Record<string, string> = { live_last_seen_at: now, updated_at: now };
  if (liveWindow(event) && !registration.attended_at) patch.attended_at = now;
  const { error } = await supabase
    .from("conference_registrations")
    .update(patch)
    .eq("id", registration.id);
  if (error) throw error;
  return { ...registration, ...patch };
}

async function participantState(supabase: any, event: any, registration: any) {
  const { data: raffle } = await supabase
    .from("conference_raffles")
    .select("id,prize_title,prize_value_cents,currency,status,opens_at,closes_at,winner_registration_id,drawn_at")
    .eq("event_id", event.id)
    .maybeSingle();

  let hasEntered = false;
  if (raffle) {
    const { data: entry } = await supabase
      .from("conference_raffle_entries")
      .select("id")
      .eq("raffle_id", raffle.id)
      .eq("registration_id", registration.id)
      .maybeSingle();
    hasEntered = !!entry;
  }

  return {
    event: {
      slug: event.slug,
      title: event.title,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      timezone: event.timezone,
      status: event.status,
    },
    participant: { firstName: registration.first_name },
    liveOpen: liveWindow(event),
    questionsOpen: questionsWindow(event),
    raffle: raffle ? {
      prizeTitle: raffle.prize_title,
      prizeValueCents: raffle.prize_value_cents,
      currency: raffle.currency,
      status: raffle.status,
      opensAt: raffle.opens_at,
      closesAt: raffle.closes_at,
      hasEntered,
      winnerDrawn: !!raffle.winner_registration_id,
    } : null,
  };
}

async function adminState(supabase: any, event: any) {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const [{ count: registrations }, { count: attendees }, { count: presentNow }] = await Promise.all([
    supabase.from("conference_registrations").select("id", { count: "exact", head: true }).eq("event_id", event.id).neq("status", "cancelled"),
    supabase.from("conference_registrations").select("id", { count: "exact", head: true }).eq("event_id", event.id).not("attended_at", "is", null).neq("status", "cancelled"),
    supabase.from("conference_registrations").select("id", { count: "exact", head: true }).eq("event_id", event.id).gte("live_last_seen_at", tenMinutesAgo).neq("status", "cancelled"),
  ]);

  const { data: questions = [] } = await supabase
    .from("conference_questions")
    .select("id,registration_id,question,status,cluster_key,ai_summary,priority,created_at,answered_at")
    .eq("event_id", event.id)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  const regIds = [...new Set((questions || []).map((q: any) => q.registration_id).filter(Boolean))];
  const names = new Map<string, string>();
  if (regIds.length) {
    const { data: regs = [] } = await supabase
      .from("conference_registrations")
      .select("id,first_name")
      .in("id", regIds);
    for (const row of regs || []) names.set(row.id, row.first_name);
  }

  const { data: raffle } = await supabase
    .from("conference_raffles")
    .select("id,prize_title,prize_value_cents,currency,status,opens_at,closes_at,winner_registration_id,drawn_at")
    .eq("event_id", event.id)
    .maybeSingle();

  let entries = 0;
  let winnerName: string | null = null;
  if (raffle) {
    const { count } = await supabase
      .from("conference_raffle_entries")
      .select("id", { count: "exact", head: true })
      .eq("raffle_id", raffle.id);
    entries = count || 0;
    if (raffle.winner_registration_id) {
      const { data: winner } = await supabase
        .from("conference_registrations")
        .select("first_name")
        .eq("id", raffle.winner_registration_id)
        .maybeSingle();
      winnerName = winner?.first_name || null;
    }
  }

  return {
    event: {
      slug: event.slug,
      title: event.title,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      timezone: event.timezone,
      status: event.status,
    },
    counts: { registrations: registrations || 0, attendees: attendees || 0, presentNow: presentNow || 0, questions: questions.length, raffleEntries: entries },
    questions: questions.map((q: any) => ({ ...q, firstName: names.get(q.registration_id) || "Participant" })),
    raffle: raffle ? { ...raffle, winnerName } : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });

  const origin = req.headers.get("origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin) && !/^https:\/\/[^/]+\.vercel\.app$/.test(origin)) {
    return json(req, { error: "Origine non autorisée." }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(req, { error: "Service indisponible." }, 503);
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const url = new URL(req.url);
  const slug = clean(url.searchParams.get("slug") || DEFAULT_SLUG, 120);
  const mode = clean(url.searchParams.get("mode"), 20);
  const event = await getEvent(supabase, slug).catch(() => null);
  if (!event) return json(req, { error: "Conférence introuvable." }, 404);

  if (mode === "admin") {
    const admin = await requireAdmin(supabase, req);
    if (!admin) return json(req, { error: "Accès administrateur requis." }, 401);

    if (req.method === "GET") return json(req, await adminState(supabase, event));

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const action = clean(body?.action, 40);

      if (action === "question_status") {
        const questionId = clean(body?.questionId, 80);
        const status = clean(body?.status, 20);
        if (!questionId || !["pending", "selected", "answered", "dismissed"].includes(status)) {
          return json(req, { error: "Action invalide." }, 400);
        }
        const patch: Record<string, unknown> = { status };
        patch.answered_at = status === "answered" ? new Date().toISOString() : null;
        const { error } = await supabase.from("conference_questions").update(patch).eq("id", questionId).eq("event_id", event.id);
        if (error) return json(req, { error: "Mise à jour impossible." }, 500);
        return json(req, { ok: true });
      }

      if (action === "draw_raffle") {
        const { data: raffle } = await supabase.from("conference_raffles").select("id").eq("event_id", event.id).maybeSingle();
        if (!raffle) return json(req, { error: "Tirage introuvable." }, 404);
        const { data, error } = await supabase.rpc("draw_conference_raffle", { p_raffle_id: raffle.id });
        if (error) return json(req, { error: "Tirage impossible." }, 500);
        if (!data?.ok) return json(req, { error: data?.reason || "Tirage impossible." }, 409);
        const { data: winner } = await supabase.from("conference_registrations").select("first_name").eq("id", data.winnerRegistrationId).maybeSingle();
        return json(req, { ok: true, alreadyDrawn: !!data.alreadyDrawn, winnerName: winner?.first_name || "Gagnant" });
      }

      return json(req, { error: "Action inconnue." }, 400);
    }

    return json(req, { error: "Méthode non autorisée." }, 405);
  }

  const registration = await getParticipant(supabase, event.id, req);
  if (!registration) return json(req, { error: "Lien LIVE invalide ou expiré." }, 401);

  if (req.method === "GET") return json(req, await participantState(supabase, event, registration));

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const action = clean(body?.action, 40);

    if (action === "heartbeat") {
      const touched = await touchPresence(supabase, registration, event).catch(() => null);
      if (!touched) return json(req, { error: "Présence impossible à enregistrer." }, 500);
      return json(req, { ok: true, attended: !!touched.attended_at, liveOpen: liveWindow(event) });
    }

    if (action === "question") {
      if (!questionsWindow(event)) return json(req, { error: "Les questions ne sont pas encore ouvertes." }, 409);
      const question = clean(body?.question, 600);
      if (question.length < 3) return json(req, { error: "Question trop courte." }, 400);
      await touchPresence(supabase, registration, event);
      const { data, error } = await supabase
        .from("conference_questions")
        .insert({ event_id: event.id, registration_id: registration.id, question })
        .select("id,created_at")
        .single();
      if (error) return json(req, { error: "Question impossible à envoyer." }, 500);
      return json(req, { ok: true, question: data }, 201);
    }

    if (action === "raffle_enter") {
      await touchPresence(supabase, registration, event);
      const { data: raffle } = await supabase.from("conference_raffles").select("id").eq("event_id", event.id).maybeSingle();
      if (!raffle) return json(req, { error: "Tirage introuvable." }, 404);
      const { data, error } = await supabase.rpc("enter_conference_raffle", { p_raffle_id: raffle.id, p_registration_id: registration.id });
      if (error) return json(req, { error: "Participation impossible." }, 500);
      if (!data?.ok) return json(req, { error: data?.reason || "Participation impossible." }, 409);
      return json(req, { ok: true });
    }

    return json(req, { error: "Action inconnue." }, 400);
  }

  return json(req, { error: "Méthode non autorisée." }, 405);
});
