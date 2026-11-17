// Adaptateur Edge commun aux webhooks Resend TEST et Production.
// Le métier (signature Svix, idempotence, caviardage et alertes) reste dans
// lib/emailDelivery.js ; ici, request.arrayBuffer() préserve les octets signés.
import { Buffer } from "node:buffer";
import process from "node:process";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { handleResendWebhook } from "../../../lib/emailDelivery.js";

(globalThis as { process?: unknown }).process ??= process;

const MAX_BODY_BYTES = 256 * 1024;

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...extra, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function isExpectedSupabaseProject(urlValue: string, expectedProjectRef: string) {
  try {
    const url = new URL(urlValue);
    return url.protocol === "https:" && url.hostname === `${expectedProjectRef}.supabase.co` && url.pathname === "/";
  } catch {
    return false;
  }
}

export function createResendWebhookEdgeHandler({
  expectedProjectRef,
  env = Deno.env.toObject(),
  database = null,
  handle = handleResendWebhook,
}: {
  expectedProjectRef: string;
  env?: Record<string, string | undefined>;
  database?: any;
  handle?: typeof handleResendWebhook;
}) {
  return async (request: Request) => {
    const url = String(env.SUPABASE_URL || "");
    // Une fonction déployée par erreur dans un autre projet ne traite rien.
    if (!isExpectedSupabaseProject(url, expectedProjectRef)) return json(503, { error: "project_mismatch" });
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_BODY_BYTES) return json(413, { error: "invalid_body" });

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    const db: any = database || (env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      : null);

    let status = 200;
    const outHeaders: Record<string, string> = {};
    let response: Response = json(500, { error: "no_response" });
    const res = {
      setHeader(key: string, value: string) { outHeaders[key.toLowerCase()] = String(value); },
      status(code: number) { status = code; return res; },
      json(body: unknown) { response = json(status, body, outHeaders); return res; },
    };
    const req = { method: "POST", headers, rawBody: Buffer.from(bytes), readable: false, body: null };

    await handle(req, res, { db, env });
    return response;
  };
}
