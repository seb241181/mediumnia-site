// Image « story » (1080×1920) du score du jour, pour Instagram, TikTok, Facebook…
// Les réseaux sociaux ne permettent pas de publier un texte depuis un site : on
// partage donc une image, via le menu de partage du téléphone quand il accepte
// les fichiers, sinon en la téléchargeant.
import { CARDS, ROUNDS } from './defiIntuition.js'

const W = 1080
const H = 1920
const GOLD = '#E4C77A'
const LOGO = '/images/brand/MEDIUMIA_logo_officiel_or_champagne_2026-09-12.png'

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function star(ctx, cx, cy, outer, inner) {
  ctx.beginPath()
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 ? inner : outer
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  ctx.closePath()
}

function card(ctx, x, y, w, h, found) {
  const r = 26
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  if (found) {
    const g = ctx.createRadialGradient(x + w / 2, y + h * 0.4, 10, x + w / 2, y + h / 2, h * 0.7)
    g.addColorStop(0, '#fff6d8'); g.addColorStop(0.55, GOLD); g.addColorStop(1, '#b8923f')
    ctx.fillStyle = g
    ctx.shadowColor = 'rgba(228,199,122,.75)'
    ctx.shadowBlur = 60
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.06)'
  }
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.lineWidth = 4
  ctx.strokeStyle = found ? GOLD : 'rgba(228,199,122,.35)'
  ctx.stroke()
  if (found) {
    ctx.fillStyle = '#1a1535'
    star(ctx, x + w / 2, y + h / 2, w * 0.24, w * 0.1)
    ctx.fill()
  } else {
    ctx.fillStyle = 'rgba(228,199,122,.35)'
    ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, 8, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

export async function drawScoreImage(canvas, { day, hits }) {
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#2a2150'); bg.addColorStop(0.55, '#1a1535'); bg.addColorStop(1, '#0f0b22')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  // A few fixed stars (same image for everyone, no randomness).
  ctx.fillStyle = 'rgba(250,246,234,.55)'
  // Sky above the title, and along the edges only: never behind text or cards.
  for (let i = 0; i < 70; i += 1) {
    const top = i < 40
    const x = top ? (i * 283) % W : (i % 2 ? 15 + ((i * 7919) % 80) : W - 15 - ((i * 6271) % 80))
    const y = top ? (i * 97) % 330 : 340 + ((i * 104729) % (H - 700))
    ctx.beginPath(); ctx.arc(x, y, (i % 3) + 1, 0, Math.PI * 2); ctx.fill()
  }

  const logo = await loadImage(LOGO)
  if (logo) {
    const h = 150
    const w = (logo.width / logo.height) * h
    ctx.drawImage(logo, (W - w) / 2, 150, w, h)
  }

  ctx.textAlign = 'center'
  ctx.fillStyle = GOLD
  ctx.font = '30px Georgia, serif'
  const [y, m, d] = day.split('-')
  if ('letterSpacing' in ctx) ctx.letterSpacing = '8px'
  ctx.fillText(`DÉFI DU ${d}/${m}/${y}`, W / 2, 400)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  // « Défi » en blanc et « Intuition » en or italique, centrés ensemble.
  ctx.textAlign = 'left'
  ctx.font = '120px Georgia, serif'
  const w1 = ctx.measureText('Défi').width
  ctx.font = 'italic 120px Georgia, serif'
  const w2 = ctx.measureText('Intuition').width
  const x0 = (W - (w1 + 30 + w2)) / 2
  ctx.font = '120px Georgia, serif'
  ctx.fillStyle = '#FAF6EA'
  ctx.fillText('Défi', x0, 560)
  ctx.font = 'italic 120px Georgia, serif'
  ctx.fillStyle = GOLD
  ctx.fillText('Intuition', x0 + w1 + 30, 560)
  ctx.textAlign = 'center'

  const cw = 250
  const ch = 375
  const gap = 45
  const total = ROUNDS * cw + (ROUNDS - 1) * gap
  hits.slice(0, ROUNDS).forEach((found, i) => card(ctx, (W - total) / 2 + i * (cw + gap), 700, cw, ch, found))

  const score = hits.filter(Boolean).length
  ctx.fillStyle = '#FAF6EA'
  ctx.font = '150px Georgia, serif'
  ctx.fillText(`${score} / ${ROUNDS}`, W / 2, 1270)
  ctx.fillStyle = '#D9D2E6'
  ctx.font = '44px Georgia, serif'
  ctx.fillText(`Étoile${score > 1 ? 's' : ''} trouvée${score > 1 ? 's' : ''} aujourd’hui`, W / 2, 1350)
  ctx.font = '38px Georgia, serif'
  ctx.fillStyle = '#B8AFCB'
  ctx.fillText(`Le hasard trouve 1 carte sur ${CARDS}.`, W / 2, 1450)

  ctx.fillStyle = '#FAF6EA'
  ctx.font = '56px Georgia, serif'
  ctx.fillText('Et vous ?', W / 2, 1590)
  ctx.fillStyle = '#D8B866'
  ctx.beginPath(); ctx.roundRect(170, 1650, W - 340, 110, 24); ctx.fill()
  ctx.fillStyle = '#141029'
  ctx.font = 'bold 44px Georgia, serif'
  ctx.fillText('mediumia.fr/defi-intuition', W / 2, 1722)
  return canvas
}

export function canvasToFile(canvas, name) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(new File([blob], name, { type: 'image/png' })) : reject(new Error('image_failed'))), 'image/png')
  })
}
