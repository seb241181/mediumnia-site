import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ORIGINS = new Set([
  "https://mediumia.fr",
  "https://www.mediumia.fr",
]);

function clean(value: unknown, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.has(origin) || /^https:\/\/[^/]+\.vercel\.app$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://mediumia.fr",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) },
  });
}

function publicEvent(event: any) {
  if (!event) return null;
  return {
    slug: event.slug,
    title: event.title,
    subtitle: event.subtitle,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    timezone: event.timezone,
    status: event.status,
    capacity: event.capacity,
    registrationOpen: event.status === "registration_open",
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

  if (req.method === "GET") {
    const url = new URL(req.url);
    const slug = clean(url.searchParams.get("slug") || "premiere-conference-mediumia", 120);
    const { data, error } = await supabase
      .from("conference_events")
      .select("slug,title,subtitle,starts_at,ends_at,timezone,status,capacity")
      .eq("slug", slug)
      .maybeSingle();
    if (error) return json(req, { error: "Impossible de charger la conférence." }, 500);
    return json(req, { event: publicEvent(data) });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const firstName = clean(body?.firstName, 80);
    const email = clean(body?.email, 254).toLowerCase();
    const slug = clean(body?.slug || "premiere-conference-mediumia", 120);
    const source = clean(body?.source || "conferences", 120);
    if (!firstName || !EMAIL_RE.test(email)) return json(req, { error: "Prénom et e-mail valides requis." }, 400);

    const ip = clean(req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("cf-connecting-ip") || "unknown", 120);
    const bytes = new TextEncoder().encode(`conference-public:${ip}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const ipHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data: rate } = await supabase.rpc("consume_api_rate_limit", {
      p_ip_hash: ipHash,
      p_endpoint: "conference_registration",
      p_hourly_limit: 20,
      p_daily_limit: 60,
    });
    if (rate && rate.allowed === false) return json(req, { error: "Trop de tentatives. Réessayez plus tard." }, 429);

    const { data: event, error: eventError } = await supabase
      .from("conference_events")
      .select("id,status,capacity")
      .eq("slug", slug)
      .maybeSingle();
    if (eventError) return json(req, { error: "Impossible de vérifier la conférence." }, 500);
    if (!event || event.status !== "registration_open") return json(req, { error: "Les inscriptions ne sont pas ouvertes." }, 409);

    if (event.capacity) {
      const { count, error: countError } = await supabase
        .from("conference_registrations")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .neq("status", "cancelled");
      if (countError) return json(req, { error: "Impossible de vérifier les places." }, 500);
      if ((count || 0) >= event.capacity) return json(req, { error: "La conférence est complète." }, 409);
    }

    const { data: existing } = await supabase
      .from("conference_registrations")
      .select("id,status")
      .eq("event_id", event.id)
      .eq("email_normalized", email)
      .maybeSingle();
    if (existing && existing.status !== "cancelled") return json(req, { ok: true, alreadyRegistered: true });

    if (existing?.status === "cancelled") {
      const { error } = await supabase
        .from("conference_registrations")
        .update({ first_name: firstName, status: "registered", source, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) return json(req, { error: "Inscription impossible." }, 500);
      return json(req, { ok: true, restored: true });
    }

    const { error } = await supabase
      .from("conference_registrations")
      .insert({ event_id: event.id, first_name: firstName, email, source });
    if (error) {
      if (error.code === "23505") return json(req, { ok: true, alreadyRegistered: true });
      console.error("conference_registration_failed");
      return json(req, { error: "Inscription impossible pour le moment." }, 500);
    }
    return json(req, { ok: true }, 201);
  }

  return json(req, { error: "Méthode non autorisée." }, 405);
});
