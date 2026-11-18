import { createResendWebhookEdgeHandler, isExpectedSupabaseProject } from "./resendWebhook.ts";

const TEST_REF = "wnbwhnqiulsdjcvkuwos";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Edge webhook garde les octets bruts et bloque un projet inattendu", async () => {
  const formatted = `{
  "type": "email.bounced",
  "data": { "to": ["client.test@example.org"], "subject": "Code 482915" }
}`;
  let received: Uint8Array | null = null;
  const handle = async (req: { rawBody: Uint8Array }, res: { status: (status: number) => { json: (body: unknown) => void } }) => {
    received = req.rawBody;
    res.status(200).json({ received: true });
  };
  const handler = createResendWebhookEdgeHandler({
    expectedProjectRef: TEST_REF,
    env: { SUPABASE_URL: `https://${TEST_REF}.supabase.co` },
    database: {},
    handle,
  });
  const response = await handler(new Request("https://example.invalid", { method: "POST", body: formatted }));
  assert(response.status === 200, "réponse attendue");
  assert(new TextDecoder().decode(received!) === formatted, "les octets formatés doivent être inchangés");

  const rejected = createResendWebhookEdgeHandler({
    expectedProjectRef: TEST_REF,
    env: { SUPABASE_URL: "https://autre-projet.supabase.co" },
    database: {},
    handle: async () => { throw new Error("ne doit jamais traiter"); },
  });
  assert((await rejected(new Request("https://example.invalid", { method: "POST", body: formatted }))).status === 503, "projet inattendu refusé");
  assert(isExpectedSupabaseProject(`https://${TEST_REF}.supabase.co`, TEST_REF), "projet attendu accepté");
  assert(!isExpectedSupabaseProject(`https://${TEST_REF}.supabase.co.evil.example`, TEST_REF), "suffixe frauduleux refusé");
});
