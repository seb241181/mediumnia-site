import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ORIGINS = new Set(["https://mediumia.fr", "https://www.mediumia.fr"]);
const EVENT_SLUG = "premiere-conference-mediumia";
const FROM_EMAIL = "MediumIA <conference@mail.mediumia.fr>";

function clean(value: unknown, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

async function sendConfirmation(firstName: string, email: string, registrationId: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("conference_confirmation_not_configured");
    return "not_configured";
  }

  const safeName = escapeHtml(firstName);
  const subject = "Votre place est réservée — Conférence MediumIA";
  const text = `Bonjour ${firstName},\n\nVotre inscription à la première conférence publique MediumIA est bien enregistrée.\n\n« Et si la médiumnité devenait accessible ? »\nVendredi 23 octobre 2026 à 19 h\nEn direct · durée prévue : 1 h 30\n\nAvant notre rencontre, vous recevrez votre carnet de préparation MediumIA. Le lien d’accès au direct vous sera transmis séparément dès qu’il sera prêt.\n\nGardez cet e-mail : il confirme votre inscription personnelle à la conférence.\n\nÀ très bientôt,\nSébastien · MediumIA`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f0e6;font-family:Georgia,serif"><table width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:32px 16px"><table width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fff"><tr><td style="background:#1a1535;padding:32px;color:#fffaf0"><p style="margin:0;color:#c9a84c;font-size:12px;letter-spacing:2px">MEDIUMIA · CONFÉRENCE OFFERTE</p><h1 style="margin:14px 0 0;font-size:28px">Votre place est réservée.</h1></td></tr><tr><td style="padding:32px;color:#514b62;font-size:16px;line-height:1.6"><p>Bonjour ${safeName},</p><p>Votre inscription à la première conférence publique MediumIA est bien enregistrée.</p><p style="font-size:20px;color:#1a1535"><strong>« Et si la médiumnité devenait accessible ? »</strong></p><p><strong>Vendredi 23 octobre 2026 à 19 h</strong><br>En direct · durée prévue : 1 h 30</p><p>Avant notre rencontre, vous recevrez votre carnet de préparation MediumIA. Le lien d’accès au direct vous sera transmis séparément dès qu’il sera prêt.</p><p style="background:#f5f0e6;padding:18px;color:#1a1535">Gardez cet e-mail : il confirme votre inscription personnelle à la conférence.</p><p>À très bientôt,<br><strong>Sébastien · MediumIA</strong></p></td></tr></table></td></tr></table></body></html>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `conference-confirmation-${registrationId}`,
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject, html, text }),
    });
    if (!response.ok) {
      console.error("conference_confirmation_failed", response.status);
      return "error";
    }
    return "sent";
  } catch {
    console.error("conference_confirmation_exception");
    return "error";
  }
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
    const slug = clean(url.searchParams.get("slug") || EVENT_SLUG, 120);
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
    const slug = clean(body?.slug || EVENT_SLUG, 120);
    const source = clean(body?.source || "conferences", 120);
    if (!firstName || !EMAIL_RE.test(email)) return json(req, { error: "Prénom et e-mail valides requis." }, 400);

    const ip = clean(req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("cf-connecting-ip") || "unknown", 120);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`conference-public:${ip}`));
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
      const emailStatus = await sendConfirmation(firstName, email, existing.id);
      return json(req, { ok: true, restored: true, emailStatus });
    }

    const { data: inserted, error } = await supabase
      .from("conference_registrations")
      .insert({ event_id: event.id, first_name: firstName, email, source })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return json(req, { ok: true, alreadyRegistered: true });
      console.error("conference_registration_failed");
      return json(req, { error: "Inscription impossible pour le moment." }, 500);
    }
    const emailStatus = await sendConfirmation(firstName, email, inserted.id);
    return json(req, { ok: true, emailStatus }, 201);
  }

  return json(req, { error: "Méthode non autorisée." }, 405);
});
