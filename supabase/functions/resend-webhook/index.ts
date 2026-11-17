// Webhook Resend destiné à la Production : publiquement atteignable seulement
// parce que Resend ne présente pas de JWT ; chaque requête est ensuite prouvée
// par Svix sur les octets bruts avant toute lecture ou écriture.
import "jsr:@supabase/functions-js@2.119.0/edge-runtime.d.ts";
import { createResendWebhookEdgeHandler } from "../_shared/resendWebhook.ts";

const PRODUCTION_PROJECT_REF = "uotkpygeqqnekpolezts";

Deno.serve(createResendWebhookEdgeHandler({ expectedProjectRef: PRODUCTION_PROJECT_REF }));
