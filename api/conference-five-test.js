/**
 * Isolated TEST endpoint. Refuses every request unless:
 * - non-production Vercel environment
 * - Supabase TEST URL
 * - CONFERENCE_FIVE_SANDBOX_ENABLED=true
 * - never PayPal live
 *
 * It does not grant training entitlements or take a real payment.
 */
import { handleConferenceFiveSandbox } from '../lib/conferenceFiveSandboxPayPal.js'

export default async function handler(req, res) {
  return handleConferenceFiveSandbox(req, res)
}
