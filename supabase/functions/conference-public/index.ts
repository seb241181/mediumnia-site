import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ORIGINS = new Set(["https://mediumia.fr", "https://www.mediumia.fr"]);
const EVENT_SLUG = "premiere-conference-mediumia";
const FROM_EMAIL = "MediumIA <conference@mail.mediumia.fr>";
const PREPARATION_BUCKET = "conference-preparation";

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

function conferenceAppBaseUrl(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (/^https:\/\/[^/]+\.vercel\.app$/.test(origin)) return origin;
  return "https://mediumia.fr";
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

function publicRaffle(raffle: any) {
  if (!raffle || raffle.status === "cancelled") return null;
  return {
    prizeTitle: raffle.prize_title,
    prizeValueCents: raffle.prize_value_cents,
    currency: raffle.currency,
  };
}

function durationLabel(event: any) {
  const start = event?.starts_at ? new Date(event.starts_at).getTime() : NaN;
  const end = event?.ends_at ? new Date(event.ends_at).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "1 h";
  const minutes = Math.round((end - start) / 60000);
  if (minutes === 60) return "1 h";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} h ${remaining}` : `${hours} h`;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function issueLiveAccess(supabase: any, registrationId: string) {
  const raw = randomToken();
  const hash = await sha256Hex(raw);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("conference_registrations")
    .update({ live_access_token_hash: hash, live_access_issued_at: now, updated_at: now })
    .eq("id", registrationId);
  if (error) {
    console.error("conference_live_access_issue_failed");
    return null;
  }
  return raw;
}

async function buildPreparationUrl(supabase: any, path?: string | null, endsAt?: string | null) {
  if (!path) return null;
  const now = Date.now();
  const fallbackExpiry = now + 45 * 24 * 60 * 60 * 1000;
  const desiredExpiry = endsAt ? new Date(endsAt).getTime() + 24 * 60 * 60 * 1000 : fallbackExpiry;
  const expiryMs = Number.isFinite(desiredExpiry)
    ? Math.max(now + 60 * 60 * 1000, Math.min(desiredExpiry, now + 60 * 24 * 60 * 60 * 1000))
    : fallbackExpiry;
  const expiresIn = Math.max(3600, Math.floor((expiryMs - now) / 1000));

  const { data, error } = await supabase.storage
    .from(PREPARATION_BUCKET)
    .createSignedUrl(path, expiresIn, { download: "MEDIUMIA_Carnet_Preparation_Conference_23-10-2026.pdf" });

  if (error || !data?.signedUrl) {
    console.error("conference_preparation_signed_url_failed");
    return null;
  }
  return data.signedUrl;
}

async function sendConfirmation(supabase: any, firstName: string, email: string, registrationId: string, event: any, liveAccessToken?: string | null, appBaseUrl = "https://mediumia.fr") {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("conference_confirmation_not_configured");
    return { status: "not_configured", preparationIncluded: false, zoomIncluded: false };
  }

  const preparationUrl = await buildPreparationUrl(supabase, event?.preparation_pdf_url, event?.ends_at);
  const zoomJoinUrl = event?.zoom_join_url || null;
  const liveUrl = liveAccessToken ? `${appBaseUrl}/live/${EVENT_SLUG}#access=${encodeURIComponent(liveAccessToken)}` : null;
  const safeName = escapeHtml(firstName);
  const safeZoomUrl = zoomJoinUrl ? escapeHtml(zoomJoinUrl) : "";
  const safePreparationUrl = preparationUrl ? escapeHtml(preparationUrl) : "";
  const safeLiveUrl = liveUrl ? escapeHtml(liveUrl) : "";
  const duration = durationLabel(event);
  const subject = "Votre place est réservée — Conférence MediumIA";

  const zoomText = zoomJoinUrl ? `\nLien Zoom : ${zoomJoinUrl}\n` : `\nLe lien d’accès au direct vous sera transmis dès qu’il sera prêt.\n`;
  const preparationText = preparationUrl ? `\nCarnet de préparation : ${preparationUrl}\n` : `\nVotre carnet de préparation vous sera transmis dès qu’il sera disponible.\n`;
  const liveText = liveUrl ? `\nEspace LIVE MediumIA (questions + tirage) : ${liveUrl}\n` : "";
  const raffleText = `\n🎁 Pendant le direct, 1 accès complet à la formation MediumIA (valeur 597 €) sera offert par tirage au sort parmi les participants présents ayant validé leur participation au tirage. Participation gratuite, sans obligation d’achat.\n`;
  const text = `Bonjour ${firstName},\n\nVotre inscription à la première conférence publique MediumIA est bien enregistrée.\n\n« Et si la médiumnité devenait accessible ? »\nVendredi 23 octobre 2026 à 19 h\nEn direct · durée prévue : ${duration}\n${raffleText}${liveText}${zoomText}${preparationText}\nGardez cet e-mail : il contient vos accès à la conférence.\n\nÀ très bientôt,\nSébastien · MediumIA`;

  const liveBlock = liveUrl
    ? `<div style="margin:26px 0;padding:20px;background:#1a1535;border-radius:10px;color:#fffaf0"><p style="margin:0 0 8px;color:#c9a84c;font-size:12px;letter-spacing:1.2px"><strong>VOTRE ESPACE LIVE MEDIUMIA</strong></p><p style="margin:0 0 16px;font-size:14px;color:#ddd7e7">Pendant le direct, posez vos questions à Sébastien et confirmez votre participation au tirage au sort depuis cet espace personnel.</p><p style="text-align:center;margin:0"><a href="${safeLiveUrl}" style="display:inline-block;background:#c9a84c;color:#1a1535;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:bold">Ouvrir mon espace LIVE</a></p><p style="margin:12px 0 0;font-size:11px;color:#bcb5c9;text-align:center">Ce lien est personnel : ne le partagez pas.</p></div>`
    : "";

  const zoomBlock = zoomJoinUrl
    ? `<p style="text-align:center;margin:28px 0"><a href="${safeZoomUrl}" style="display:inline-block;background:#c9a84c;color:#1a1535;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:bold">Rejoindre la conférence sur Zoom</a></p><p style="font-size:13px;color:#706a80;text-align:center">Accès au direct du 23 octobre à 19 h.</p>`
    : `<p>Le lien d’accès au direct vous sera transmis dès qu’il sera prêt.</p>`;

  const preparationBlock = preparationUrl
    ? `<p style="text-align:center;margin:28px 0"><a href="${safePreparationUrl}" style="display:inline-block;background:#1a1535;color:#fffaf0;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:bold">Télécharger mon carnet de préparation</a></p><p style="font-size:13px;color:#706a80;text-align:center">Gardez-le près de vous pour préparer votre expérience avant le direct.</p>`
    : `<p>Votre carnet de préparation MediumIA vous sera transmis dès qu’il sera disponible.</p>`;

  const raffleBlock = `<div style="margin:26px 0;padding:20px;border:1px solid #c9a84c;background:#fbf7ea;border-radius:10px;color:#1a1535"><p style="margin:0 0 7px;font-size:12px;letter-spacing:1.2px;color:#9a7b2f"><strong>TIRAGE AU SORT EN DIRECT</strong></p><p style="margin:0"><strong>1 formation MediumIA complète offerte — valeur 597 €.</strong></p><p style="margin:8px 0 0;font-size:13px;color:#706a80">Participation gratuite, sans obligation d’achat, réservée aux participants présents en direct ayant validé leur participation au tirage.</p></div>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f5f0e6;font-family:Georgia,serif"><table width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:32px 16px"><table width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fff"><tr><td style="background:#1a1535;padding:32px;color:#fffaf0"><p style="margin:0;color:#c9a84c;font-size:12px;letter-spacing:2px">MEDIUMIA · CONFÉRENCE OFFERTE</p><h1 style="margin:14px 0 0;font-size:28px">Votre place est réservée.</h1></td></tr><tr><td style="padding:32px;color:#514b62;font-size:16px;line-height:1.6"><p>Bonjour ${safeName},</p><p>Votre inscription à la première conférence publique MediumIA est bien enregistrée.</p><p style="font-size:20px;color:#1a1535"><strong>« Et si la médiumnité devenait accessible ? »</strong></p><p><strong>Vendredi 23 octobre 2026 à 19 h</strong><br>En direct · durée prévue : ${duration}</p>${raffleBlock}${liveBlock}${preparationBlock}${zoomBlock}<p style="background:#f5f0e6;padding:18px;color:#1a1535">Gardez cet e-mail : il contient vos accès à la conférence.</p><p>À très bientôt,<br><strong>Sébastien · MediumIA</strong></p></td></tr></table></td></tr></table></body></html>`;

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
      return { status: "error", preparationIncluded: !!preparationUrl, zoomIncluded: !!zoomJoinUrl };
    }
    return { status: "sent", preparationIncluded: !!preparationUrl, zoomIncluded: !!zoomJoinUrl };
  } catch {
    console.error("conference_confirmation_exception");
    return { status: "error", preparationIncluded: !!preparationUrl, zoomIncluded: !!zoomJoinUrl };
  }
}

async function markDelivery(supabase: any, registrationId: string, result: any) {
  if (result?.status !== "sent") return;
  const now = new Date().toISOString();
  const patch: Record<string, string> = { updated_at: now };
  if (result.preparationIncluded) patch.preparation_sent_at = now;
  if (result.zoomIncluded) patch.zoom_sent_at = now;
  if (Object.keys(patch).length > 1) {
    await supabase.from("conference_registrations").update(patch).eq("id", registrationId);
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
    const { data: event, error } = await supabase
      .from("conference_events")
      .select("id,slug,title,subtitle,starts_at,ends_at,timezone,status,capacity")
      .eq("slug", slug)
      .maybeSingle();
    if (error) return json(req, { error: "Impossible de charger la conférence." }, 500);
    if (!event) return json(req, { event: null, raffle: null });

    const { data: raffle } = await supabase
      .from("conference_raffles")
      .select("prize_title,prize_value_cents,currency,status")
      .eq("event_id", event.id)
      .maybeSingle();
    return json(req, { event: publicEvent(event), raffle: publicRaffle(raffle) });
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
      .select("id,status,capacity,zoom_join_url,preparation_pdf_url,starts_at,ends_at")
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

    if (existing && existing.status !== "cancelled") {
      return json(req, { ok: true, alreadyRegistered: true });
    }

    if (existing?.status === "cancelled") {
      const { error } = await supabase
        .from("conference_registrations")
        .update({ first_name: firstName, status: "registered", source, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) return json(req, { error: "Inscription impossible." }, 500);
      const liveToken = await issueLiveAccess(supabase, existing.id);
      const delivery = await sendConfirmation(supabase, firstName, email, existing.id, event, liveToken, conferenceAppBaseUrl(req));
      await markDelivery(supabase, existing.id, delivery);
      return json(req, { ok: true, restored: true, emailStatus: delivery.status });
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

    const liveToken = await issueLiveAccess(supabase, inserted.id);
    const delivery = await sendConfirmation(supabase, firstName, email, inserted.id, event, liveToken, conferenceAppBaseUrl(req));
    await markDelivery(supabase, inserted.id, delivery);
    return json(req, { ok: true, emailStatus: delivery.status, testLiveUrl: testLiveUrl(req, liveToken) }, 201);
  }

  return json(req, { error: "Méthode non autorisée." }, 405);
});
