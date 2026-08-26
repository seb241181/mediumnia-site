import { createHash, randomBytes } from 'node:crypto'

export const CANCELLATION_NOTICE_HOURS = 24

export function createCancellationToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashCancellationToken(token) }
}

export function hashCancellationToken(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) return null
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function cancellationCutoff(startsAt, noticeHours = CANCELLATION_NOTICE_HOURS) {
  const startMs = new Date(startsAt).getTime()
  if (!Number.isFinite(startMs)) return null
  return new Date(startMs - noticeHours * 3_600_000)
}

export function canSelfCancel(startsAt, now = new Date(), noticeHours = CANCELLATION_NOTICE_HOURS) {
  const cutoff = cancellationCutoff(startsAt, noticeHours)
  const nowMs = new Date(now).getTime()
  return !!cutoff && Number.isFinite(nowMs) && nowMs <= cutoff.getTime()
}

export function bookingCancellationUrl(token) {
  const configured = process.env.BOOKING_PUBLIC_URL?.trim().replace(/\/$/, '')
  let base

  // En Preview, le lien doit rester sur le déploiement Preview même si une URL
  // publique de Production existe aussi dans les variables d'environnement.
  if (process.env.VERCEL_ENV === 'preview') {
    const previewHost = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL
    if (previewHost) base = `https://${previewHost}`
  }

  if (!base) base = configured
  if (!base) base = 'https://mediumia.fr'
  // Le fragment n'est pas envoyé au serveur dans la requête HTTP ni dans le Referer.
  // La page le lit localement puis transmet le token uniquement à notre API.
  return `${base}/rdv/annuler#token=${encodeURIComponent(token)}`
}
