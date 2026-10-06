import { CHANNELS, PROFILES, percentages } from './quizSensibilite.js'

const W = 1080
const H = 1920
const GOLD = '#E4C77A'
const CREAM = '#FAF6EA'
const MUTED = '#C8C0D8'
const LOGO = '/images/brand/MEDIUMIA_logo_officiel_or_champagne_2026-09-12.png'

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function drawBackground(ctx) {
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#302557')
  bg.addColorStop(0.55, '#191235')
  bg.addColorStop(1, '#0C091B')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = 'rgba(250,246,234,.55)'
  for (let i = 0; i < 84; i += 1) {
    const x = 22 + ((i * 7919) % (W - 44))
    const y = 18 + ((i * 104729) % (H - 36))
    const r = 1 + (i % 3)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

function fitText(ctx, text, maxWidth, startSize, minSize = 28, weight = '') {
  let size = startSize
  while (size > minSize) {
    ctx.font = `${weight}${size}px Georgia, serif`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 2
  }
  return size
}

export async function drawQuizStoryImage(canvas, result) {
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  drawBackground(ctx)

  const logo = await loadImage(LOGO)
  if (logo) {
    const h = 145
    const w = (logo.width / logo.height) * h
    ctx.drawImage(logo, (W - w) / 2, 120, w, h)
  }

  const dominant = result?.dominant
  const profile = PROFILES[dominant] || PROFILES.sensation
  const pct = percentages(result?.scores || {})

  ctx.textAlign = 'center'
  ctx.fillStyle = GOLD
  ctx.font = '30px Georgia, serif'
  if ('letterSpacing' in ctx) ctx.letterSpacing = '9px'
  ctx.fillText('MON CANAL DE PERCEPTION', W / 2, 390)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'

  ctx.fillStyle = CREAM
  const titleSize = fitText(ctx, profile.name, W - 150, 108, 62)
  ctx.font = `${titleSize}px Georgia, serif`
  ctx.fillText(profile.name, W / 2, 555)

  ctx.fillStyle = GOLD
  ctx.font = 'italic 48px Georgia, serif'
  ctx.fillText(`« ${profile.motto} »`, W / 2, 655)

  ctx.fillStyle = MUTED
  const sign = profile.signs?.[0] || 'Votre perception se révèle dans votre manière de ressentir.'
  const signSize = fitText(ctx, sign, W - 180, 34, 25)
  ctx.font = `${signSize}px Georgia, serif`
  ctx.fillText(sign, W / 2, 770)

  let y = 950
  for (const channel of CHANNELS) {
    const isDominant = channel === dominant
    ctx.textAlign = 'left'
    ctx.fillStyle = isDominant ? CREAM : MUTED
    ctx.font = `${isDominant ? 'bold ' : ''}36px Georgia, serif`
    ctx.fillText(PROFILES[channel].name, 165, y)
    ctx.textAlign = 'right'
    ctx.fillText(`${pct[channel]} %`, 895, y)

    const barY = y + 28
    const barW = 730
    ctx.fillStyle = 'rgba(255,255,255,.12)'
    ctx.beginPath()
    ctx.roundRect(165, barY, barW, 22, 11)
    ctx.fill()

    if (pct[channel] > 0) {
      ctx.fillStyle = isDominant ? GOLD : 'rgba(228,199,122,.55)'
      ctx.beginPath()
      ctx.roundRect(165, barY, Math.max(16, barW * pct[channel] / 100), 22, 11)
      ctx.fill()
    }
    y += 135
  }

  ctx.textAlign = 'center'
  ctx.fillStyle = MUTED
  ctx.font = '37px Georgia, serif'
  ctx.fillText('Quiz gratuit · 2 minutes', W / 2, 1550)

  ctx.fillStyle = CREAM
  ctx.font = '58px Georgia, serif'
  ctx.fillText('Et vous, quel est le vôtre ?', W / 2, 1650)

  ctx.fillStyle = '#D8B866'
  ctx.beginPath()
  ctx.roundRect(145, 1710, W - 290, 118, 28)
  ctx.fill()
  ctx.fillStyle = '#16102F'
  ctx.font = 'bold 40px Georgia, serif'
  ctx.fillText('mediumia.fr/quiz-sensibilite', W / 2, 1786)

  return canvas
}

export function canvasToQuizFile(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (
      blob
        ? resolve(new File([blob], 'mon-canal-mediumia.png', { type: 'image/png' }))
        : reject(new Error('image_failed'))
    ), 'image/png')
  })
}
