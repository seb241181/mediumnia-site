/* global process */
/**
 * Parcours de récupération du mot de passe de l'espace RDV.
 *
 * Ce module reste séparé de la réservation classique et partage uniquement la
 * fonction Vercel physique de /api/rdv-book afin de respecter la limite Hobby.
 * Le lien envoyé contient le token_hash dans le fragment : un scanner d'e-mail
 * peut ouvrir la page, mais il ne peut pas consommer le jeton côté serveur.
 */
import { createHmac } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { sendEmail } from './transactionalEmail.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SANDBOX_PROJECT_HOST = 'wnbwhnqiulsdjcvkuwos.supabase.co'
const SANDBOX_BRANCH = 'agent/rdv-paypal'
const HOURLY_LIMIT = 3
const DAILY_LIMIT = 6

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function extractClientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (!forwarded) return null
  return forwarded.split(',')[0].trim().toLowerCase()
}

function runtimeUsesExpectedSandbox() {
  if (process.env.VERCEL_ENV !== 'preview') return false
  if (process.env.VERCEL_GIT_COMMIT_REF !== SANDBOX_BRANCH) return false

  try {
    return new URL(process.env.SUPABASE_URL || '').hostname === SANDBOX_PROJECT_HOST
  } catch {
    return false
  }
}

function recoveryOrigin() {
  const hostname = String(process.env.VERCEL_BRANCH_URL || '').trim().toLowerCase()
  if (!/^[a-z0-9.-]+\.vercel\.app$/.test(hostname)) return null
  return `https://${hostname}`
}

function accepted(res) {
  return res.status(202).json({
    ok: true,
    message: 'Si cette adresse correspond à un compte praticien, un e-mail vient d’être envoyé.',
  })
}

async function consumeRecoveryRateLimit(req, res, supabase) {
  const secret = String(process.env.RDV_RATE_LIMIT_SECRET || '').trim()
  const clientIp = extractClientIp(req)

  if (!/^[0-9a-fA-F]{64}$/.test(secret) || !clientIp) {
    res.status(503).json({ error: 'Service temporairement indisponible.' })
    return false
  }

  const ipHash = createHmac('sha256', secret).update(clientIp).digest('hex')

  try {
    const { data, error } = await supabase.rpc('consume_api_rate_limit', {
      p_ip_hash: ipHash,
      p_endpoint: 'rdv_auth_recovery',
      p_hourly_limit: HOURLY_LIMIT,
      p_daily_limit: DAILY_LIMIT,
    })
    if (error) throw error
    if (!data?.allowed) {
      res.status(429).json({ error: 'Trop de demandes. Réessayez plus tard.' })
      return false
    }
  } catch {
    console.error('[rdv-auth-recovery] Rate limit unavailable')
    res.status(503).json({ error: 'Service temporairement indisponible.' })
    return false
  }

  return true
}

async function emailBelongsToPractitioner(supabase, email) {
  const { data: practitioners, error } = await supabase
    .from('booking_practitioners')
    .select('owner_id')
    .not('owner_id', 'is', null)

  if (error) throw error

  const ownerIds = [...new Set((practitioners || []).map(row => row.owner_id).filter(Boolean))]
  for (const ownerId of ownerIds) {
    const { data, error: userError } = await supabase.auth.admin.getUserById(ownerId)
    if (userError) continue
    if (normalizeEmail(data?.user?.email) === email) return true
  }
  return false
}

function recoveryEmailHtml(recoveryUrl) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mot de passe MediumIA</title></head>
<body style="margin:0;padding:0;background:#FAFAF7;font-family:Georgia,serif;color:#1A1535;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <p style="font-size:20px;font-weight:700;margin:0 0 30px;letter-spacing:.12em;color:#C9A84C;">✦ MEDIUMIA</p>
    <h1 style="font-size:22px;font-weight:600;margin:0 0 18px;">Choisissez votre mot de passe</h1>
    <p style="font-size:15px;line-height:1.7;margin:0 0 24px;">Cliquez sur le bouton ci-dessous. Le lien ne sera validé qu’au moment où vous enregistrerez votre nouveau mot de passe.</p>
    <p style="margin:0 0 24px;"><a href="${recoveryUrl}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#1A1535;color:#C9A84C;text-decoration:none;font-weight:700;">Choisir mon mot de passe →</a></p>
    <p style="font-size:12px;line-height:1.6;color:#6B6384;margin:0;">Si vous n’avez pas demandé cet e-mail, vous pouvez simplement l’ignorer.</p>
  </div>
</body></html>`
}

function recoveryEmailText(recoveryUrl) {
  return `MediumIA — Choisissez votre mot de passe

Ouvrez le lien ci-dessous. Il ne sera validé qu’au moment où vous enregistrerez votre nouveau mot de passe :

${recoveryUrl}

Si vous n’avez pas demandé cet e-mail, vous pouvez simplement l’ignorer.`
}

export async function handleRdvAuthRecoveryApi(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!runtimeUsesExpectedSandbox()) return res.status(403).json({ error: 'preview_sandbox_only' })
  if (!isSupabaseConfigured()) return res.status(503).json({ error: 'supabase_not_configured' })

  const email = normalizeEmail(req.body?.email)
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' })

  const origin = recoveryOrigin()
  if (!origin) return res.status(503).json({ error: 'preview_url_not_configured' })

  const supabase = getSupabaseAdmin()
  if (!await consumeRecoveryRateLimit(req, res, supabase)) return

  let isPractitioner = false
  try {
    isPractitioner = await emailBelongsToPractitioner(supabase, email)
  } catch {
    console.error('[rdv-auth-recovery] Practitioner lookup failed')
    return accepted(res)
  }

  // Réponse identique pour une adresse inconnue afin d'éviter l'énumération.
  if (!isPractitioner) return accepted(res)

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
  })
  const tokenHash = data?.properties?.hashed_token

  if (error || !tokenHash) {
    console.error('[rdv-auth-recovery] Recovery token generation failed')
    return accepted(res)
  }

  // Le fragment n'est jamais transmis au serveur lors d'un simple GET.
  const recoveryUrl = `${origin}/rdv/reset-password#token_hash=${encodeURIComponent(tokenHash)}&type=recovery`
  const delivery = await sendEmail({
    to: email,
    subject: 'MediumIA — Choisissez votre mot de passe',
    html: recoveryEmailHtml(recoveryUrl),
    text: recoveryEmailText(recoveryUrl),
  })

  if (delivery.status !== 'sent') {
    console.error(`[rdv-auth-recovery] Recovery email not sent (${delivery.status})`)
  } else {
    console.info('[rdv-auth-recovery] Recovery email sent')
  }

  return accepted(res)
}
