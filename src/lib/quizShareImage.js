// Image « story » du résultat du quiz des canaux : canal dominant, devise et
// répartition des quatre canaux.
import { CHANNELS, PROFILES, percentages } from './quizSensibilite.js'
import { GOLD, STORY_W, STORY_H, drawCallToAction, drawStoryBackground, spacedText, wrapLines } from './shareImage.js'

export async function drawQuizImage(canvas, { dominant, scores }) {
  canvas.width = STORY_W
  canvas.height = STORY_H
  const ctx = canvas.getContext('2d')
  await drawStoryBackground(ctx)
  const profile = PROFILES[dominant]

  ctx.textAlign = 'center'
  ctx.fillStyle = GOLD
  ctx.font = '30px Georgia, serif'
  spacedText(ctx, 'MON CANAL DE PERCEPTION', 400)

  ctx.fillStyle = '#FAF6EA'
  ctx.font = '112px Georgia, serif'
  ctx.fillText(profile.name, STORY_W / 2, 560)
  ctx.fillStyle = GOLD
  ctx.font = 'italic 52px Georgia, serif'
  ctx.fillText(`« ${profile.motto} »`, STORY_W / 2, 650)

  ctx.fillStyle = '#D9D2E6'
  ctx.font = '38px Georgia, serif'
  wrapLines(ctx, profile.signs[0], STORY_W - 240).slice(0, 2).forEach((line, i) => ctx.fillText(line, STORY_W / 2, 760 + i * 52))

  const pct = percentages(scores)
  const left = 170
  const barW = STORY_W - 2 * left
  CHANNELS.forEach((channel, i) => {
    const y = 940 + i * 130
    ctx.textAlign = 'left'
    ctx.fillStyle = channel === dominant ? '#FAF6EA' : '#B8AFCB'
    ctx.font = `${channel === dominant ? 'bold ' : ''}40px Georgia, serif`
    ctx.fillText(PROFILES[channel].name, left, y)
    ctx.textAlign = 'right'
    ctx.fillText(`${pct[channel]} %`, left + barW, y)
    ctx.fillStyle = 'rgba(255,255,255,.1)'
    ctx.beginPath(); ctx.roundRect(left, y + 22, barW, 22, 11); ctx.fill()
    if (pct[channel] > 0) {
      ctx.fillStyle = channel === dominant ? GOLD : 'rgba(228,199,122,.55)'
      ctx.beginPath(); ctx.roundRect(left, y + 22, Math.max(22, (barW * pct[channel]) / 100), 22, 11); ctx.fill()
    }
  })

  ctx.textAlign = 'center'
  ctx.fillStyle = '#B8AFCB'
  ctx.font = '36px Georgia, serif'
  ctx.fillText('Quiz gratuit · 2 minutes', STORY_W / 2, 1480)
  drawCallToAction(ctx, 'Et vous, quel est le vôtre ?', 'mediumia.fr/quiz-sensibilite')
  return canvas
}
