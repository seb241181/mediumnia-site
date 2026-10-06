const W = 1080
const H = 1920
const GOLD = '#E4C77A'
const CREAM = '#FAF6EA'
const DEEP = '#16102F'
const MUTED = '#C8C0D8'
const LOGO = '/images/brand/MEDIUMIA_logo_officiel_or_champagne_2026-09-12.png'
const POSITIONS = ['OMBRE', 'PASSAGE', 'GUÉRISON']

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

function fitText(ctx, text, maxWidth, startSize, minSize = 24, weight = '') {
  let size = startSize
  while (size > minSize) {
    ctx.font = `${weight}${size}px Georgia, serif`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 2
  }
  return size
}

function roundedImage(ctx, img, x, y, w, h, radius) {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
  ctx.clip()

  const scale = Math.max(w / img.width, h / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  ctx.restore()
}

export async function drawOracleStoryImage(canvas, cards = []) {
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

  ctx.textAlign = 'center'
  ctx.fillStyle = GOLD
  ctx.font = '30px Georgia, serif'
  if ('letterSpacing' in ctx) ctx.letterSpacing = '9px'
  ctx.fillText('ORACLE AU-DELÀ DE L’ÂME', W / 2, 380)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'

  ctx.fillStyle = CREAM
  ctx.font = '72px Georgia, serif'
  ctx.fillText('Votre tirage', W / 2, 490)

  const frameY = 650
  const frameW = 280
  const frameH = 465
  const gap = 36
  const total = frameW * 3 + gap * 2
  const startX = (W - total) / 2

  await Promise.all(cards.slice(0, 3).map(async (card, index) => {
    const x = startX + index * (frameW + gap)
    ctx.fillStyle = '#FFFDF8'
    ctx.strokeStyle = GOLD
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.roundRect(x, frameY, frameW, frameH, 24)
    ctx.fill()
    ctx.stroke()

    const img = await loadImage(`/images/oracle/${card?.id}.png`)
    if (img) {
      roundedImage(ctx, img, x + 25, frameY + 25, frameW - 50, 330, 8)
    } else {
      ctx.fillStyle = '#0D0A16'
      ctx.fillRect(x + 25, frameY + 25, frameW - 50, 330)
      ctx.fillStyle = GOLD
      ctx.font = '54px Georgia, serif'
      ctx.fillText('✦', x + frameW / 2, frameY + 210)
    }

    ctx.fillStyle = '#7D6657'
    const cardName = String(card?.name || 'Votre carte')
    const nameSize = fitText(ctx, cardName, frameW - 36, 27, 19, 'italic ')
    ctx.font = `italic ${nameSize}px Georgia, serif`
    ctx.fillText(cardName, x + frameW / 2, frameY + 410)

    ctx.fillStyle = GOLD
    ctx.font = '28px Georgia, serif'
    ctx.fillText(POSITIONS[index], x + frameW / 2, frameY + frameH + 58)

    ctx.fillStyle = MUTED
    const labelSize = fitText(ctx, cardName, frameW - 20, 25, 18)
    ctx.font = `${labelSize}px Georgia, serif`
    ctx.fillText(cardName, x + frameW / 2, frameY + frameH + 105)
  }))

  ctx.fillStyle = MUTED
  ctx.font = '38px Georgia, serif'
  ctx.fillText('Tirage test offert · lecture guidée par Lumïa', W / 2, 1460)

  ctx.fillStyle = CREAM
  ctx.font = '58px Georgia, serif'
  ctx.fillText('Tirez vos cartes', W / 2, 1570)

  ctx.fillStyle = '#D8B866'
  ctx.beginPath()
  ctx.roundRect(145, 1640, W - 290, 118, 28)
  ctx.fill()
  ctx.fillStyle = DEEP
  ctx.font = 'bold 43px Georgia, serif'
  ctx.fillText('mediumia.fr/oracle', W / 2, 1716)

  return canvas
}

export function oracleStoryText(cards = []) {
  const names = cards.slice(0, 3).map((card) => card?.name).filter(Boolean)
  return `✦ Mon tirage Oracle Au-delà de l’Âme : ${names.join(' · ')}\nTirage test offert sur https://mediumia.fr/oracle`
}

export function canvasToOracleFile(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (
      blob
        ? resolve(new File([blob], 'tirage-oracle-mediumia.png', { type: 'image/png' }))
        : reject(new Error('image_failed'))
    ), 'image/png')
  })
}
