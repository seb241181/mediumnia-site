// Partage d'une image « story » (1080×1920) depuis le site : Instagram, TikTok
// et Facebook n'acceptent pas un texte venu d'un site, mais une image, oui.
// Menu de partage du téléphone quand il accepte les fichiers, sinon
// téléchargement de l'image pour l'ajouter à la main.

export const STORY_W = 1080
export const STORY_H = 1920
export const GOLD = '#E4C77A'
export const LOGO = '/images/brand/MEDIUMIA_logo_officiel_or_champagne_2026-09-12.png'

export function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

export function canvasToFile(canvas, name) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(new File([blob], name, { type: 'image/png' })) : reject(new Error('image_failed'))), 'image/png')
  })
}

// Fond nuit étoilée et logo MediumIA, communs à toutes les images.
export async function drawStoryBackground(ctx) {
  const bg = ctx.createLinearGradient(0, 0, 0, STORY_H)
  bg.addColorStop(0, '#2a2150'); bg.addColorStop(0.55, '#1a1535'); bg.addColorStop(1, '#0f0b22')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, STORY_W, STORY_H)
  ctx.fillStyle = 'rgba(250,246,234,.55)'
  for (let i = 0; i < 70; i += 1) {
    const top = i < 40
    const x = top ? (i * 283) % STORY_W : (i % 2 ? 15 + ((i * 7919) % 80) : STORY_W - 15 - ((i * 6271) % 80))
    const y = top ? (i * 97) % 330 : 340 + ((i * 104729) % (STORY_H - 700))
    ctx.beginPath(); ctx.arc(x, y, (i % 3) + 1, 0, Math.PI * 2); ctx.fill()
  }
  const logo = await loadImage(LOGO)
  if (logo) {
    const h = 150
    const w = (logo.width / logo.height) * h
    ctx.drawImage(logo, (STORY_W - w) / 2, 150, w, h)
  }
}

export function spacedText(ctx, text, y, spacing = '8px') {
  if ('letterSpacing' in ctx) ctx.letterSpacing = spacing
  ctx.fillText(text, STORY_W / 2, y)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
}

// Découpe un texte en lignes qui tiennent dans maxWidth.
export function wrapLines(ctx, text, maxWidth) {
  const lines = []
  let line = ''
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

// Bouton doré du bas avec l'adresse à taper.
export function drawCallToAction(ctx, question, url) {
  ctx.textAlign = 'center'
  ctx.fillStyle = '#FAF6EA'
  ctx.font = '56px Georgia, serif'
  ctx.fillText(question, STORY_W / 2, 1590)
  ctx.fillStyle = '#D8B866'
  ctx.beginPath(); ctx.roundRect(150, 1650, STORY_W - 300, 110, 24); ctx.fill()
  ctx.fillStyle = '#141029'
  ctx.font = 'bold 44px Georgia, serif'
  ctx.fillText(url, STORY_W / 2, 1722)
}

function downloadFile(file) {
  const url = URL.createObjectURL(file)
  const link = Object.assign(document.createElement('a'), { href: url, download: file.name })
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return 'downloaded'
}

// Renvoie 'shared' | 'downloaded' | 'cancelled'. Seule une annulation de
// l'utilisateur (AbortError) renvoie 'cancelled' ; tout autre échec du partage
// (activation expirée, restriction de la plateforme…) retombe sur le
// téléchargement, pour que le bouton ne reste jamais sans effet.
export async function shareImageFile(file, text) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text })
      return 'shared'
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'
      return downloadFile(file)
    }
  }
  return downloadFile(file)
}
