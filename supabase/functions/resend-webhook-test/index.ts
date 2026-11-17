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
import "jsr:@supabase/functions-js@2.119.0/edge-runtime.d.ts";
import { createResendWebhookEdgeHandler } from "../_shared/resendWebhook.ts";

const TEST_PROJECT_REF = "wnbwhnqiulsdjcvkuwos";

Deno.serve(createResendWebhookEdgeHandler({ expectedProjectRef: TEST_PROJECT_REF }));
