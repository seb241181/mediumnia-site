import { handleResendWebhook } from '../lib/emailDelivery.js'

// Resend signe les octets exacts du corps. Cette route doit donc rester
// distincte des API qui utilisent le parseur JSON Vercel.
export const config = {
  api: {
    bodyParser: false,
  },
}

export function createResendWebhookHandler(handle = handleResendWebhook) {
  return async function handler(req, res) {
    return handle(req, res)
  }
}

export default createResendWebhookHandler()
