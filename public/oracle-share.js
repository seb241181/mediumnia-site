(() => {
  const GOLD = '#c9a84c'
  const DEEP = '#1a1535'
  const CREAM = '#f8f5ee'
  const MIST = '#756f81'

  function loadHistoryModule() {
    if (document.querySelector('script[data-chronosphere-history]')) return
    const script = document.createElement('script')
    script.src = '/oracle-history.js'
    script.dataset.chronosphereHistory = 'true'
    document.head.appendChild(script)
  }

  loadHistoryModule()

  function injectStyles() {
    const style = document.createElement('style')
    style.textContent = `
      .share-panel{display:none;margin-top:18px;padding:22px 24px;border:1px solid rgba(201,168,76,.38);border-radius:20px;background:rgba(255,255,255,.72);text-align:center}
      .share-panel.visible{display:block}.share-panel strong{display:block;font-size:18px;font-weight:400;margin-bottom:7px}.share-panel p{margin:0 0 15px;color:#756f81;font-size:12px;line-height:1.55}
      .share-panel button{max-width:360px;margin:0 auto}.share-status{min-height:18px;margin-top:9px;color:#756f81;font-size:11px}
    `
    document.head.appendChild(style)
  }

  function formatDate(value) {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!m) return ''
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 99) {
    const words = String(text || '').split(/\s+/).filter(Boolean)
    let line = ''
    let lines = 0
    for (let i = 0; i < words.length; i += 1) {
      const test = line ? `${line} ${words[i]}` : words[i]
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y)
        y += lineHeight
        lines += 1
        line = words[i]
        if (lines >= maxLines - 1) break
      } else {
        line = test
      }
    }
    if (line && lines < maxLines) ctx.fillText(line, x, y)
    return y + lineHeight
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
  }

  function createCanvasCard(data) {
    const canvas = document.createElement('canvas')
    canvas.width = 1080
    canvas.height = 1350
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = CREAM
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.strokeStyle = GOLD
    ctx.lineWidth = 3
    roundedRect(ctx, 48, 48, 984, 1254, 36)
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.fillStyle = GOLD
    ctx.font = '26px Georgia, serif'
    ctx.fillText('ORACLE DES LIGNES DE TEMPS', 540, 130)

    ctx.fillStyle = DEEP
    ctx.font = '64px Georgia, serif'
    ctx.fillText('CHRONOSPHERE 999', 540, 215)

    ctx.fillStyle = MIST
    ctx.font = '24px Georgia, serif'
    ctx.fillText('Une lecture MediumIA', 540, 260)

    ctx.strokeStyle = 'rgba(201,168,76,.45)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(150, 305); ctx.lineTo(930, 305); ctx.stroke()

    ctx.fillStyle = GOLD
    ctx.font = '24px Georgia, serif'
    ctx.fillText(data.direction ? 'TENDANCE DU TIRAGE' : 'TA LIGNE DE TEMPS', 540, 370)

    ctx.fillStyle = DEEP
    ctx.font = '48px Georgia, serif'
    const direction = data.direction || 'Lecture CHRONOSPHERE'
    wrapText(ctx, direction, 540, 430, 820, 58, 2)

    const cards = Array.isArray(data.cards) ? data.cards.slice(0, 3) : []
    const startY = 570
    const boxW = 270
    const gap = 36
    const total = cards.length * boxW + Math.max(0, cards.length - 1) * gap
    let boxX = (1080 - total) / 2

    cards.forEach((card, index) => {
      ctx.fillStyle = index === 0 ? 'rgba(201,168,76,.14)' : 'rgba(255,255,255,.68)'
      ctx.strokeStyle = index === 0 ? GOLD : 'rgba(201,168,76,.45)'
      ctx.lineWidth = index === 0 ? 3 : 2
      roundedRect(ctx, boxX, startY, boxW, 250, 24)
      ctx.fill(); ctx.stroke()

      ctx.fillStyle = GOLD
      ctx.font = '20px Georgia, serif'
      ctx.fillText(index === 0 ? 'FRÉQUENCE PRINCIPALE' : `RÉSONANCE ${index}`, boxX + boxW / 2, startY + 48)

      ctx.fillStyle = DEEP
      ctx.font = '28px Georgia, serif'
      wrapText(ctx, card.name || '', boxX + boxW / 2, startY + 105, boxW - 36, 36, 3)

      ctx.fillStyle = MIST
      ctx.font = '20px Georgia, serif'
      ctx.fillText(`N°${String(card.number || '').padStart(2, '0')}`, boxX + boxW / 2, startY + 218)
      boxX += boxW + gap
    })

    const primary = data.primary
    if (primary?.start && primary?.end) {
      ctx.fillStyle = GOLD
      ctx.font = '24px Georgia, serif'
      ctx.fillText('FENÊTRE PRIORITAIRE', 540, 900)

      ctx.fillStyle = DEEP
      ctx.font = '36px Georgia, serif'
      ctx.fillText(`${formatDate(primary.start)} → ${formatDate(primary.end)}`, 540, 955)

      if (primary.peak) {
        ctx.fillStyle = MIST
        ctx.font = '23px Georgia, serif'
        ctx.fillText(`Pic calculé : ${formatDate(primary.peak)}`, 540, 1000)
      }
    }

    ctx.strokeStyle = 'rgba(201,168,76,.45)'
    ctx.beginPath(); ctx.moveTo(180, 1080); ctx.lineTo(900, 1080); ctx.stroke()

    ctx.fillStyle = DEEP
    ctx.font = '30px Georgia, serif'
    ctx.fillText('mediumia.fr', 540, 1150)

    ctx.fillStyle = MIST
    ctx.font = '20px Georgia, serif'
    ctx.fillText('Lecture symbolique · Ligne de temps mobile', 540, 1190)
    ctx.fillText('Aucune donnée personnelle n’est affichée sur cette carte.', 540, 1230)

    return canvas
  }

  async function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('image_generation_failed')), 'image/png', 0.96)
    })
  }

  async function shareCard(status) {
    const data = window.__chronosphereShare
    if (!data?.cards?.length) return
    status.textContent = 'Création de la carte…'
    try {
      const canvas = createCanvasCard(data)
      const blob = await canvasBlob(canvas)
      const file = new File([blob], 'CHRONOSPHERE-999.png', { type: 'image/png' })

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'CHRONOSPHERE 999',
          text: 'Mon tirage CHRONOSPHERE 999 · MediumIA',
        })
        status.textContent = 'Carte prête à être partagée.'
        return
      }

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'CHRONOSPHERE-999.png'
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
      status.textContent = 'Carte créée.'
    } catch (error) {
      if (error?.name === 'AbortError') {
        status.textContent = ''
        return
      }
      console.error('[chronosphere-share]', error)
      status.textContent = 'La carte n’a pas pu être créée pour le moment.'
    }
  }

  function mount() {
    injectStyles()
    const act = document.getElementById('act')
    if (!act) return

    const panel = document.createElement('div')
    panel.id = 'sharePanel'
    panel.className = 'share-panel'
    panel.innerHTML = `
      <strong>Partager ton tirage</strong>
      <p>La carte publique masque ton nom, ta naissance, ton lieu et ta question personnelle.</p>
      <button id="shareChronosphere" type="button">Créer ma carte partageable →</button>
      <div id="shareStatus" class="share-status"></div>
    `
    act.insertAdjacentElement('afterend', panel)

    const button = panel.querySelector('#shareChronosphere')
    const status = panel.querySelector('#shareStatus')
    button.addEventListener('click', () => shareCard(status))

    const observer = new MutationObserver(() => {
      panel.classList.toggle('visible', Boolean(window.__chronosphereShare?.cards?.length))
    })
    observer.observe(document.getElementById('results'), { attributes: true, childList: true, subtree: true })
    window.__chronosphereSharePanel = panel
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()
})()
