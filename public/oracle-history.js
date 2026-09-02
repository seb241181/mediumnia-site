(() => {
  const STORAGE_KEY = 'chronosphere999:timeline-history:v1'
  const MAX_SNAPSHOTS = 20
  const STANDARD_THEMES = new Set(['amour', 'travail', 'finances', 'energie', 'direction de vie', 'projet'])
  const originalFetch = window.fetch.bind(window)

  let latest = null
  let activeResume = null
  let historyPanel = null
  let trackingPanel = null
  let comparePanel = null
  let resumeNotice = null

  function safeParse(value, fallback) {
    try { return JSON.parse(value) } catch { return fallback }
  }

  function loadHistory() {
    const data = safeParse(localStorage.getItem(STORAGE_KEY), [])
    return Array.isArray(data) ? data.filter(Boolean) : []
  }

  function saveHistory(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_SNAPSHOTS)))
      return true
    } catch (error) {
      console.error('[chronosphere-history] storage failed', error)
      return false
    }
  }

  function uid() {
    return crypto?.randomUUID?.() || `line-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]))
  }

  function normalizeText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ')
  }

  function extractDirection(interpretation) {
    const match = String(interpretation || '').match(/Tendance (favorable(?: mais en construction)?|mitigée|peu porteuse actuellement)/i)
    return match ? `Tendance ${match[1]}` : null
  }

  function formatDateTime(value) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
  }

  function parseYmd(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!match) return null
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }

  function shortDate(value) {
    const date = parseYmd(value)
    if (!date) return ''
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
  }

  function themeLabel(theme) {
    const clean = normalizeText(theme)
    if (!clean) return 'Question personnelle'
    return clean.length > 72 ? `${clean.slice(0, 69)}…` : clean
  }

  function latestByLine(history) {
    const map = new Map()
    for (const item of history) {
      const key = item.lineId || item.id
      if (!map.has(key)) map.set(key, item)
    }
    return [...map.values()].slice(0, 6)
  }

  function injectStyles() {
    const style = document.createElement('style')
    style.textContent = `
      .history-box{margin:18px 0 0;padding:22px 24px;border:1px solid rgba(201,168,76,.28);border-radius:20px;background:rgba(255,255,255,.58)}
      .history-box h3,.tracking-box h3,.compare-box h3{margin:0;font:400 19px Georgia,serif}.history-box>p,.tracking-box>p,.compare-box>p{margin:7px 0 0;color:#756f81;font-size:12px;line-height:1.55}
      .history-list{display:grid;gap:9px;margin-top:15px}.history-item{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 14px;border:1px solid rgba(201,168,76,.25);border-radius:14px;background:white}
      .history-item .meta{min-width:0}.history-item b{display:block;font-size:14px;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.history-item small{display:block;margin-top:4px;color:#756f81;font-size:11px}.history-item button{width:auto;padding:9px 12px;font-size:12px;white-space:nowrap}
      .resume-notice{display:none;margin:14px 0 0;padding:12px 14px;border-left:3px solid #c9a84c;background:rgba(201,168,76,.08);border-radius:0 12px 12px 0;color:#4f495b;font-size:12px;line-height:1.5}.resume-notice.visible{display:block}
      .tracking-box{display:none;margin-top:18px;padding:22px 24px;border:1px solid rgba(201,168,76,.38);border-radius:20px;background:rgba(255,255,255,.72)}.tracking-box.visible{display:block}.tracking-box button{margin-top:14px}.tracking-status{min-height:18px;margin-top:8px;color:#756f81;font-size:11px;text-align:center}
      .compare-box{display:none;margin:0 0 18px;padding:24px;border:2px solid rgba(201,168,76,.45);border-radius:22px;background:linear-gradient(135deg,rgba(26,21,53,.035),rgba(201,168,76,.10))}.compare-box.visible{display:block}
      .compare-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}.compare-card{padding:14px;border-radius:14px;background:white;border:1px solid rgba(201,168,76,.22)}.compare-card span{display:block;color:#c9a84c;font-size:10px;text-transform:uppercase;letter-spacing:.12em}.compare-card b{display:block;margin-top:6px;font-size:14px;font-weight:400;line-height:1.45}.compare-card small{display:block;margin-top:5px;color:#756f81;font-size:11px;line-height:1.45}
      @media(max-width:620px){.history-item{align-items:flex-start;flex-direction:column}.history-item button{width:100%}.compare-grid{grid-template-columns:1fr}}
    `
    document.head.appendChild(style)
  }

  function mountPanels() {
    const form = document.getElementById('form')
    const results = document.getElementById('results')
    const timeline = document.getElementById('timeline')
    const act = document.getElementById('act')
    if (!form || !results || !act) return false

    historyPanel = document.createElement('section')
    historyPanel.className = 'history-box'
    historyPanel.innerHTML = `
      <h3>Revenir sur une ligne</h3>
      <p>Les tirages que tu choisis de conserver restent uniquement dans ce navigateur sur cet appareil.</p>
      <div id="historyList" class="history-list"></div>
      <div id="resumeNotice" class="resume-notice"></div>
    `
    form.insertAdjacentElement('afterend', historyPanel)
    resumeNotice = historyPanel.querySelector('#resumeNotice')

    trackingPanel = document.createElement('section')
    trackingPanel.className = 'tracking-box'
    trackingPanel.innerHTML = `
      <h3>Suivre cette ligne dans le temps</h3>
      <p>Conserve ce tirage comme point de repère. Tu pourras revenir plus tard sur la même question et voir ce qui a changé.</p>
      <button id="saveTimelineCheckpoint" type="button">Conserver cette ligne sur cet appareil →</button>
      <div id="trackingStatus" class="tracking-status"></div>
    `
    act.insertAdjacentElement('afterend', trackingPanel)

    comparePanel = document.createElement('section')
    comparePanel.className = 'compare-box'
    if (timeline) timeline.insertAdjacentElement('afterend', comparePanel)
    else results.insertAdjacentElement('afterbegin', comparePanel)

    trackingPanel.querySelector('#saveTimelineCheckpoint').addEventListener('click', saveLatestCheckpoint)
    renderHistory()
    return true
  }

  function renderHistory() {
    if (!historyPanel) return
    const list = historyPanel.querySelector('#historyList')
    const items = latestByLine(loadHistory())
    if (!items.length) {
      list.innerHTML = '<div style="color:#756f81;font-size:12px;padding:4px 0">Aucune ligne conservée pour le moment.</div>'
      return
    }
    list.innerHTML = items.map(item => `
      <div class="history-item">
        <div class="meta">
          <b>${esc(themeLabel(item.theme))}</b>
          <small>${esc(formatDateTime(item.createdAt))}${item.direction ? ` · ${esc(item.direction.replace(/^Tendance\s+/i, ''))}` : ''}</small>
        </div>
        <button type="button" data-resume="${esc(item.id)}">Revenir sur cette ligne</button>
      </div>
    `).join('')
    list.querySelectorAll('[data-resume]').forEach(button => {
      button.addEventListener('click', () => resumeSnapshot(button.dataset.resume))
    })
  }

  function resumeSnapshot(id) {
    const snapshot = loadHistory().find(item => item.id === id)
    if (!snapshot) return
    activeResume = snapshot

    const profile = snapshot.profile || {}
    const setValue = (id, value) => { const el = document.getElementById(id); if (el) el.value = value || '' }
    setValue('fullName', profile.fullName)
    setValue('birthDate', profile.birthDate)
    setValue('birthTime', profile.birthTime)
    setValue('birthPlace', profile.birthPlace)

    const themeSelect = document.getElementById('theme')
    const customTheme = document.getElementById('customTheme')
    if (themeSelect) {
      const normalized = normalizeText(snapshot.theme).toLowerCase()
      if (STANDARD_THEMES.has(normalized)) {
        themeSelect.value = normalized
        themeSelect.dispatchEvent(new Event('change'))
      } else {
        themeSelect.value = 'autre'
        themeSelect.dispatchEvent(new Event('change'))
        if (customTheme) {
          customTheme.value = snapshot.theme || ''
          customTheme.dispatchEvent(new Event('input'))
        }
      }
    }

    ;['n1', 'n2', 'n3'].forEach(id => setValue(id, ''))
    if (resumeNotice) {
      resumeNotice.innerHTML = `<strong>Ligne rouverte :</strong> ${esc(themeLabel(snapshot.theme))}<br>Dernier repère : ${esc(formatDateTime(snapshot.createdAt))}. Choisis à nouveau trois nombres : le moteur recalculera le ciel d’aujourd’hui et comparera les deux étapes.`
      resumeNotice.classList.add('visible')
    }
    document.getElementById('form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function makeSnapshot(payload, response) {
    const body = payload || {}
    const profile = body.profile || {}
    const timing = response?.sky?.timing || null
    return {
      id: uid(),
      lineId: activeResume?.lineId || activeResume?.id || uid(),
      createdAt: new Date().toISOString(),
      theme: normalizeText(body.theme || response?.theme),
      profile: {
        fullName: normalizeText(profile.fullName),
        birthDate: profile.birthDate || '',
        birthTime: profile.birthTime || '',
        birthPlace: normalizeText(profile.birthPlace),
      },
      numbers: Array.isArray(body.numbers) ? body.numbers.slice(0, 3) : [],
      direction: extractDirection(response?.interpretation),
      timing,
      cards: Array.isArray(response?.cards) ? response.cards.slice(0, 3).map(card => ({ number: card.number, name: card.name })) : [],
      interpretation: String(response?.interpretation || ''),
      engine: response?.engine || null,
    }
  }

  function sameCards(a, b) {
    const aa = (a || []).map(card => card?.name).filter(Boolean)
    const bb = (b || []).map(card => card?.name).filter(Boolean)
    return aa.length === bb.length && aa.every((name, index) => name === bb[index])
  }

  function rangeLabel(window) {
    if (!window) return 'Aucune fenêtre calculée'
    const start = shortDate(window.start)
    const end = shortDate(window.end)
    const peak = shortDate(window.peak)
    let text = start && end ? `${start} → ${end}` : (start || end || 'Fenêtre non datée')
    if (peak) text += ` · pic ${peak}`
    return text
  }

  function compareSnapshots(previous, current) {
    const changes = []
    const oldDirection = previous?.direction || 'Pas de tendance directionnelle'
    const newDirection = current?.direction || 'Pas de tendance directionnelle'
    changes.push({ label: 'Tendance', main: newDirection, detail: oldDirection === newDirection ? 'La direction générale reste stable.' : `Avant : ${oldDirection}.` })

    const oldPrimary = previous?.timing?.primary
    const newPrimary = current?.timing?.primary
    const oldPeak = oldPrimary?.peak || ''
    const newPeak = newPrimary?.peak || ''
    changes.push({ label: 'Fenêtre prioritaire', main: rangeLabel(newPrimary), detail: oldPeak === newPeak ? 'Le pic principal reste au même endroit.' : `Avant : ${rangeLabel(oldPrimary)}.` })

    const oldCaution = previous?.timing?.caution
    const newCaution = current?.timing?.caution
    const cautionChanged = (oldCaution?.peak || '') !== (newCaution?.peak || '')
    changes.push({
      label: 'Zone de prudence',
      main: newCaution ? rangeLabel(newCaution) : 'Aucune zone prioritaire',
      detail: cautionChanged ? `Avant : ${oldCaution ? rangeLabel(oldCaution) : 'aucune zone prioritaire'}.` : 'La zone de prudence reste comparable.',
    })

    const cardNames = (current?.cards || []).map(card => card.name).join(' · ')
    const oldCardNames = (previous?.cards || []).map(card => card.name).join(' · ')
    changes.push({
      label: 'Fréquences tirées',
      main: cardNames || '—',
      detail: sameCards(previous?.cards, current?.cards) ? 'Les mêmes fréquences sont revenues.' : `Avant : ${oldCardNames || '—'}.`,
    })
    return changes
  }

  function renderComparison(previous, current) {
    if (!comparePanel || !previous || !current) return
    const changes = compareSnapshots(previous, current)
    const elapsedMs = new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime()
    const elapsedDays = Math.max(0, Math.round(elapsedMs / 86400000))
    comparePanel.innerHTML = `
      <h3>Ce qui a changé sur cette ligne</h3>
      <p>Comparaison avec ton repère du ${esc(formatDateTime(previous.createdAt))}${elapsedDays ? ` · ${elapsedDays} jour${elapsedDays > 1 ? 's' : ''} plus tard` : ''}. Le ciel est recalculé au nouvel instant et les cartes reflètent le nouveau tirage.</p>
      <div class="compare-grid">
        ${changes.map(change => `<div class="compare-card"><span>${esc(change.label)}</span><b>${esc(change.main)}</b><small>${esc(change.detail)}</small></div>`).join('')}
      </div>
    `
    comparePanel.classList.add('visible')
  }

  function showTracking(snapshot) {
    latest = snapshot
    if (!trackingPanel) return
    trackingPanel.classList.add('visible')
    const button = trackingPanel.querySelector('#saveTimelineCheckpoint')
    const status = trackingPanel.querySelector('#trackingStatus')
    button.textContent = activeResume ? 'Enregistrer cette nouvelle étape →' : 'Conserver cette ligne sur cet appareil →'
    status.textContent = activeResume ? 'La comparaison est affichée. Tu peux conserver ce nouveau repère dans la même ligne.' : 'Rien n’est envoyé à notre base : ce repère reste dans ce navigateur.'
    if (activeResume) renderComparison(activeResume, snapshot)
    else if (comparePanel) { comparePanel.classList.remove('visible'); comparePanel.innerHTML = '' }
  }

  function saveLatestCheckpoint() {
    if (!latest) return
    const wasResume = Boolean(activeResume)
    const history = loadHistory()
    const snapshot = { ...latest, id: uid(), lineId: latest.lineId || activeResume?.lineId || activeResume?.id || uid() }
    const next = [snapshot, ...history]
    const ok = saveHistory(next)
    const status = trackingPanel?.querySelector('#trackingStatus')
    if (!ok) {
      if (status) status.textContent = 'Le navigateur n’a pas permis d’enregistrer ce repère.'
      return
    }
    if (status) status.textContent = wasResume ? 'Nouvelle étape enregistrée sur cet appareil.' : 'Ligne enregistrée sur cet appareil.'
    latest = snapshot
    activeResume = null
    renderHistory()
  }

  window.fetch = async function chronosphereHistoryFetch(input, init) {
    const response = await originalFetch(input, init)
    try {
      const url = typeof input === 'string' ? input : input?.url || ''
      const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase()
      if (method === 'POST' && url.includes('/api/oracle-interpret') && response.ok) {
        const payload = typeof init?.body === 'string' ? safeParse(init.body, {}) : {}
        response.clone().json().then(data => {
          const snapshot = makeSnapshot(payload, data)
          setTimeout(() => showTracking(snapshot), 0)
        }).catch(() => {})
      }
    } catch (error) {
      console.error('[chronosphere-history] capture failed', error)
    }
    return response
  }

  function init() {
    injectStyles()
    if (!mountPanels()) return
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()