import { escapeHtml, sendEmail } from './transactionalEmail.js'

export function normalizeDeliveryEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

function dateRange(window) {
  if (!window?.start) return null
  return window.end && window.end !== window.start ? `${window.start} au ${window.end}` : window.start
}

function timingLine(label, window) {
  const range = dateRange(window)
  if (!range) return null
  const peak = window.peak ? ` (point fort : ${window.peak})` : ''
  return `${label} : ${range}${peak}`
}

function htmlTimingLine(label, window) {
  const line = timingLine(label, window)
  return line ? `<li>${escapeHtml(line)}</li>` : ''
}

export function buildChronosphereEmail(result) {
  const profile = result?.profile || {}
  const timing = result?.sky?.timing || {}
  const cards = Array.isArray(result?.cards) ? result.cards : []
  const primary = timingLine('Fenêtre principale', timing.primary)
  const alternative = timingLine('Alternative utile', timing.alternatives?.[0])
  const caution = timingLine('Zone de prudence', timing.caution)
  const textTiming = [primary, alternative, caution].filter(Boolean).join('\n') || 'Aucune fenêtre temporelle complémentaire n’a été calculée.'
  const cardRows = cards.map((card) => (
    `<li><strong>${escapeHtml(card.name)}</strong> — ${escapeHtml(card.block)}${card.density ? `, ${escapeHtml(card.density)}` : ''}</li>`
  )).join('')
  const textCards = cards.map((card) => (
    `${card.name} — ${card.block}${card.density ? `, ${card.density}` : ''}`
  )).join('\n')
  const interpretation = String(result?.interpretation || '')

  return {
    subject: 'Votre ligne de temps CHRONOSPHERE 999',
    html: `<!doctype html>
<html lang="fr">
  <body style="margin:0;background:#f8f5ee;color:#1a1535;font-family:Georgia,serif;">
    <main style="max-width:640px;margin:0 auto;padding:36px 24px;">
      <p style="margin:0 0 8px;color:#a98536;font-size:12px;letter-spacing:1.8px;text-transform:uppercase;">MediumIA</p>
      <h1 style="margin:0 0 24px;font-size:28px;font-weight:normal;">Votre ligne de temps CHRONOSPHERE 999</h1>
      <p style="margin:0 0 24px;line-height:1.7;">Bonjour ${escapeHtml(profile.fullName)}, voici la lecture complète de votre tirage sur le thème « ${escapeHtml(result?.theme)} ».</p>
      <h2 style="font-size:18px;font-weight:normal;">Vos trois fréquences</h2>
      <ul style="margin:0 0 24px;padding-left:20px;line-height:1.7;">${cardRows}</ul>
      <h2 style="font-size:18px;font-weight:normal;">Vos fenêtres temporelles</h2>
      <ul style="margin:0 0 24px;padding-left:20px;line-height:1.7;">${htmlTimingLine('Fenêtre principale', timing.primary)}${htmlTimingLine('Alternative utile', timing.alternatives?.[0])}${htmlTimingLine('Zone de prudence', timing.caution)}</ul>
      <h2 style="font-size:18px;font-weight:normal;">Votre lecture complète</h2>
      <div style="line-height:1.8;white-space:pre-line;">${escapeHtml(interpretation)}</div>
      <p style="margin:28px 0 0;line-height:1.7;color:#5f5870;">Votre ligne de temps reste mobile : elle se transforme avec vos choix, vos actes et votre état intérieur.</p>
    </main>
  </body>
</html>`,
    text: `Votre ligne de temps CHRONOSPHERE 999\n\nBonjour ${profile.fullName},\n\nThème : ${result?.theme}\n\nVos trois fréquences\n${textCards}\n\nVos fenêtres temporelles\n${textTiming}\n\nVotre lecture complète\n${interpretation}\n\nVotre ligne de temps reste mobile : elle se transforme avec vos choix, vos actes et votre état intérieur.`,
  }
}

export async function sendChronosphereEmail({ drawId, deliveryEmail, result }) {
  const content = buildChronosphereEmail(result)
  return sendEmail({
    to: deliveryEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
    idempotencyKey: `chronosphere-result-${drawId}`,
  })
}
