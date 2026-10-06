// Image « story » d'un tirage Oracle offert : les cartes tirées et leur
// position. L'interprétation reste privée (page du site) ; on ne partage que
// les visuels, pour donner envie sans rien dévoiler de personnel.
import { GOLD, STORY_W, STORY_H, drawCallToAction, drawStoryBackground, loadImage, spacedText, wrapLines } from './shareImage.js'

export async function drawOracleImage(canvas, { spreadName, cards, positions }) {
  canvas.width = STORY_W
  canvas.height = STORY_H
  const ctx = canvas.getContext('2d')
  await drawStoryBackground(ctx)

  ctx.textAlign = 'center'
  ctx.fillStyle = GOLD
  ctx.font = '30px Georgia, serif'
  spacedText(ctx, 'ORACLE AU-DELÀ DE L’ÂME', 400)

  ctx.fillStyle = '#FAF6EA'
  ctx.font = '72px Georgia, serif'
  wrapLines(ctx, spreadName || 'Mon tirage', STORY_W - 220).slice(0, 2).forEach((line, i) => ctx.fillText(line, STORY_W / 2, 510 + i * 82))

  const list = (cards || []).slice(0, 3)
  const cw = 250
  const ch = 402
  const gap = 45
  const total = list.length * cw + (list.length - 1) * gap
  const top = 700
  const images = await Promise.all(list.map((card) => loadImage(`/images/oracle/${card.id}.png`)))
  list.forEach((card, i) => {
    const x = (STORY_W - total) / 2 + i * (cw + gap)
    ctx.save()
    ctx.beginPath(); ctx.roundRect(x, top, cw, ch, 20)
    ctx.strokeStyle = GOLD; ctx.lineWidth = 4; ctx.stroke()
    ctx.clip()
    const img = images[i]
    if (img) ctx.drawImage(img, x, top, cw, ch)
    else { ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(x, top, cw, ch) }
    ctx.restore()
    ctx.textAlign = 'center'
    ctx.fillStyle = GOLD
    ctx.font = '26px Georgia, serif'
    const label = (positions?.[i]?.label || '').toUpperCase()
    if (label) ctx.fillText(label, x + cw / 2, top + ch + 46)
    ctx.fillStyle = '#D9D2E6'
    ctx.font = '30px Georgia, serif'
    wrapLines(ctx, card.name || '', cw + gap).slice(0, 2).forEach((line, j) => ctx.fillText(line, x + cw / 2, top + ch + 92 + j * 36))
  })

  ctx.textAlign = 'center'
  ctx.fillStyle = '#B8AFCB'
  ctx.font = '36px Georgia, serif'
  ctx.fillText('Tirage test offert · lecture guidée par Lumïa', STORY_W / 2, 1490)
  drawCallToAction(ctx, 'Tirez vos cartes', 'mediumia.fr/oracle')
  return canvas
}
