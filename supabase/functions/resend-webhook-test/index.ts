// Webhook Resend — relais de TEST uniquement (#219).
//
// La préversion Vercel TEST est protégée par Vercel Authentication, et une
// exception « Automation Bypass » ouvrirait TOUTE la préversion à quiconque
// détient la clé. Cette fonction expose donc une seule adresse publique, sur
// Supabase TEST, qui exécute exactement le même code que
// /api/resend-webhook (lib/emailDelivery.js) :
//   - signature Svix obligatoire (401 sinon), 503 sans RESEND_WEBHOOK_SECRET ;
//   - enregistrement idempotent, alerte unique ;
//   - aucune autre route, aucune lecture de données en réponse.
// Elle refuse de fonctionner hors du projet Supabase TEST.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Buffer } from "node:buffer";
import process from "node:process";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleResendWebhook } from "../../../lib/emailDelivery.js";

// Les modules partagés lisent process.env (Node) : on garantit sa présence.
(globalThis as { process?: unknown }).process ??= process;

const TEST_PROJECT_REF = "wnbwhnqiulsdjcvkuwos";
const MAX_BODY_BYTES = 256 * 1024;

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...extra, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

Deno.serve(async (request: Request) => {
  const env = Deno.env.toObject();
  const url = String(env.SUPABASE_URL || "");
  if (!url.includes(`${TEST_PROJECT_REF}.supabase.co`)) return json(503, { error: "test_only" });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BODY_BYTES) return json(413, { error: "invalid_body" });

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });

  const db = env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

  // Adaptateur minimal req/res (forme Vercel/Node) autour du gestionnaire partagé.
  let status = 200;
  const outHeaders: Record<string, string> = {};
  let response: Response = json(500, { error: "no_response" });
  const res = {
    setHeader(key: string, value: string) { outHeaders[key.toLowerCase()] = String(value); },
    status(code: number) { status = code; return res; },
    json(body: unknown) { response = json(status, body, outHeaders); return res; },
  };
  const req = { method: "POST", headers, rawBody: Buffer.from(bytes), readable: false, body: null };

  await handleResendWebhook(req, res, { db, env });
  return response;
});
