import { escapeHtml, sendEmail } from './transactionalEmail.js'
import { buildChronosphereResumeUrl } from './chronosphereResume.js'

export function normalizeDeliveryEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

export function formatFrenchDate(value) {
  if (typeof value !== 'string') return value
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

function dateRange(window) {
  if (!window?.start) return null
  const start = formatFrenchDate(window.start)
  return window.end && window.end !== window.start ? `${start} au ${formatFrenchDate(window.end)}` : start
}

function timingLine(label, window) {
  const range = dateRange(window)
  if (!range) return null
  const peak = window.peak ? ` (point fort : ${formatFrenchDate(window.peak)})` : ''
  return `${label} : ${range}${peak}`
}

function htmlTimingLine(label, window) {
  const line = timingLine(label, window)
  return line ? `<tr><td style="padding:0 0 10px;color:#756d7e;font-size:13px;line-height:1.5;">${escapeHtml(label)}</td><td style="padding:0 0 10px;color:#1a1535;font-size:13px;line-height:1.5;text-align:right;">${escapeHtml(line.replace(`${label} : `, ''))}</td></tr>` : ''
}

function buildPackEmailSection(pack) {
  const creditsRemaining = Number(pack?.creditsRemaining)
  if (!Number.isInteger(creditsRemaining)) return { html: '', text: '' }

  if (creditsRemaining === 1 || creditsRemaining === 2) {
    const resumeUrl = buildChronosphereResumeUrl(pack?.packToken)
    if (!resumeUrl) return { html: '', text: '' }
    const remainingText = creditsRemaining === 1
      ? 'Il vous reste 1 tirage Chronosphère.'
      : 'Il vous reste 2 tirages Chronosphère.'
    const buttonText = creditsRemaining === 1
      ? 'Utiliser mon dernier tirage'
      : 'Utiliser mes 2 tirages restants'

    return {
      html: `<div style="margin-top:28px;padding:22px 20px;border:1px solid #e1d2aa;border-radius:16px;background:#faf6ea;text-align:center;">
            <p style="margin:0 0 8px;color:#a98536;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">Votre pack Chronosphère</p>
            <p style="margin:0 0 18px;color:#1a1535;font-size:15px;line-height:1.6;">${remainingText}</p>
            <a href="${escapeHtml(resumeUrl)}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#1a1535;color:#f8f5ee;font-size:14px;text-decoration:none;">${buttonText}</a>
            <p style="margin:14px 0 0;color:#756d7e;font-size:11px;line-height:1.5;">Ce lien est personnel. Ne le partagez pas.</p>
          </div>`,
      text: `\n\nVOTRE PACK CHRONOSPHÈRE\n${remainingText}\n${buttonText} : ${resumeUrl}\nCe lien est personnel. Ne le partagez pas.`,
    }
  }

  if (creditsRemaining === 0) {
    const publicUrl = 'https://mediumia.fr/chronosphere'
    return {
      html: `<div style="margin-top:28px;padding:22px 20px;border:1px solid #e1d2aa;border-radius:16px;background:#faf6ea;text-align:center;">
            <p style="margin:0 0 8px;color:#a98536;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">Votre pack Chronosphère</p>
            <p style="margin:0 0 18px;color:#1a1535;font-size:15px;line-height:1.6;">Votre pack de 3 tirages est maintenant terminé.</p>
            <a href="${publicUrl}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#1a1535;color:#f8f5ee;font-size:14px;text-decoration:none;">Obtenir 3 nouveaux tirages — 9,90 €</a>
          </div>`,
      text: `\n\nVOTRE PACK CHRONOSPHÈRE\nVotre pack de 3 tirages est maintenant terminé.\nObtenir 3 nouveaux tirages — 9,90 € : ${publicUrl}`,
    }
  }

  return { html: '', text: '' }
}

export function buildChronosphereEmail(result, pack = null) {
  const profile = result?.profile || {}
  const timing = result?.sky?.timing || {}
  const cards = Array.isArray(result?.cards) ? result.cards : []
  const primary = timingLine('Fenêtre principale', timing.primary)
  const alternative = timingLine('Alternative utile', timing.alternatives?.[0])
  const caution = timingLine('Zone de prudence', timing.caution)
  const textTiming = [primary, alternative, caution].filter(Boolean).join('\n') || 'Aucune fenêtre temporelle complémentaire n’a été calculée.'
  const cardRows = cards.map((card) => (
    `<tr><td style="padding:0 0 10px;color:#a98536;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Fréquence ${escapeHtml(card.number)}</td><td style="padding:0 0 10px;color:#1a1535;font-size:14px;text-align:right;"><strong>${escapeHtml(card.name)}</strong><br><span style="color:#756d7e;font-size:12px;">${escapeHtml(card.block)}${card.density ? ` · ${escapeHtml(card.density)}` : ''}</span></td></tr>`
  )).join('')
  const textCards = cards.map((card) => (
    `${card.name} — ${card.block}${card.density ? `, ${card.density}` : ''}`
  )).join('\n')
  const interpretation = String(result?.interpretation || '')
  const packSection = buildPackEmailSection(pack)

  return {
    subject: 'Votre ligne de temps CHRONOSPHERE 999',
    html: `<!doctype html>
<html lang="fr">
  <body style="margin:0;background:#f3efe6;color:#1a1535;font-family:Georgia,serif;">
    <main style="max-width:640px;margin:0 auto;padding:24px 12px 40px;">
      <section style="overflow:hidden;border-radius:22px;background:#1a1535;box-shadow:0 14px 36px rgba(26,21,53,.14);">
        <div style="padding:34px 28px 30px;text-align:center;">
          <p style="margin:0 0 12px;color:#d4b469;font-size:11px;letter-spacing:2.4px;text-transform:uppercase;">MediumIA présente</p>
          <h1 style="margin:0;color:#f8f5ee;font-size:29px;font-weight:normal;letter-spacing:.04em;">CHRONOSPHERE 999</h1>
          <p style="margin:12px 0 0;color:#d9d3c7;font-size:14px;font-style:italic;">Oracle des Lignes de Temps</p>
        </div>
        <div style="height:1px;background:linear-gradient(90deg,transparent,#d4b469,transparent);"></div>
        <div style="padding:28px;background:#fffdf8;">
          <p style="margin:0 0 16px;color:#1a1535;font-size:18px;line-height:1.55;">Bonjour ${escapeHtml(profile.fullName)},</p>
          <p style="margin:0;color:#5f5870;font-size:15px;line-height:1.75;">Voici la lecture complète de votre ligne de temps. Elle éclaire la dynamique de votre thème et les fenêtres qui peuvent accompagner vos prochains choix.</p>
          <div style="margin:24px 0;padding:20px;border:1px solid #e1d2aa;border-radius:16px;background:#faf6ea;">
            <p style="margin:0 0 14px;color:#a98536;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">Synthèse du tirage</p>
            <p style="margin:0 0 18px;color:#1a1535;font-size:15px;line-height:1.6;"><strong>Thème</strong><br>${escapeHtml(result?.theme)}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${cardRows}</table>
          </div>
          <div style="margin:24px 0;padding:20px;border-left:3px solid #d4b469;background:#f8f5ee;">
            <p style="margin:0 0 14px;color:#a98536;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">Fenêtres temporelles</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${htmlTimingLine('Fenêtre principale', timing.primary)}${htmlTimingLine('Alternative utile', timing.alternatives?.[0])}${htmlTimingLine('Zone de prudence', timing.caution)}</table>
          </div>
          <p style="margin:30px 0 12px;color:#a98536;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">Votre lecture complète</p>
          <div style="padding:22px 0 4px;border-top:1px solid #e9e1d0;color:#2f2940;font-size:15px;line-height:1.9;white-space:pre-line;">${escapeHtml(interpretation)}</div>
          ${packSection.html}
          <div style="margin-top:28px;padding:18px 20px;border-radius:14px;background:#1a1535;color:#f8f5ee;text-align:center;">
            <p style="margin:0;font-size:14px;line-height:1.7;">Votre ligne de temps reste mobile : elle se transforme avec vos choix, vos actes et votre état intérieur.</p>
          </div>
        </div>
      </section>
      <p style="margin:20px 0 0;color:#756d7e;font-size:12px;line-height:1.6;text-align:center;">MediumIA · Une lecture symbolique et introspective, à recevoir comme un espace de discernement.</p>
    </main>
  </body>
</html>`,
    text: `CHRONOSPHERE 999 — Oracle des Lignes de Temps\n\nBonjour ${profile.fullName},\n\nVoici la lecture complète de votre ligne de temps.\n\nSYNTHÈSE DU TIRAGE\nThème : ${result?.theme}\n\nVos trois fréquences\n${textCards}\n\nFenêtres temporelles\n${textTiming}\n\nVOTRE LECTURE COMPLÈTE\n${interpretation}${packSection.text}\n\nVotre ligne de temps reste mobile : elle se transforme avec vos choix, vos actes et votre état intérieur.\n\nMediumIA — Une lecture symbolique et introspective, à recevoir comme un espace de discernement.`,
  }
}

export async function sendChronosphereEmail({ drawId, deliveryEmail, result, pack }) {
  const content = buildChronosphereEmail(result, pack)
  return sendEmail({
    to: deliveryEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
    idempotencyKey: `chronosphere-result-${drawId}`,
  })
}
