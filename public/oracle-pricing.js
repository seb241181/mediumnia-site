(() => {
  const HISTORY_KEY = 'chronosphere999:timeline-history:v1'
  const PLAN_KEY = 'chronosphere999:follow-plans:v1'
  const FOLLOW_PRICE = 7.90
  const BASE_PRICE = 5
  const FOLLOW_DAYS = 90
  const MAX_RETURNS = 2
  const DAY_MS = 86400000
  const originalFetch = window.fetch.bind(window)

  let pricingPanel = null
  let pendingResumeLineId = null
  let mounted = false

  function safeParse(value, fallback) {
    try { return JSON.parse(value) } catch { return fallback }
  }

  function loadHistory() {
    const data = safeParse(localStorage.getItem(HISTORY_KEY), [])
    return Array.isArray(data) ? data.filter(Boolean) : []
  }

  function loadPlans() {
    const data = safeParse(localStorage.getItem(PLAN_KEY), {})
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  }

  function savePlans(plans) {
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify(plans))
      return true
    } catch (error) {
      console.error('[chronosphere-pricing] plan storage failed', error)
      return false
    }
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]))
  }

  function money(value) {
    return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(value)
  }

  function formatDate(value) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
  }

  function lineIdFor(snapshot) {
    return snapshot?.lineId || snapshot?.id || null
  }

  function latestSnapshotForLine(lineId) {
    return loadHistory().find(item => lineIdFor(item) === lineId) || null
  }

  function planState(lineId) {
    const plan = loadPlans()[lineId]
    if (!plan) return { active: false, reason: 'none', remaining: 0, plan: null }
    const expires = new Date(plan.expiresAt).getTime()
    const expired = !Number.isFinite(expires) || expires <= Date.now()
    const used = Math.max(0, Number(plan.usedReturns) || 0)
    const max = Math.max(0, Number(plan.maxReturns) || MAX_RETURNS)
    const remaining = Math.max(0, max - used)
    if (expired) return { active: false, reason: 'expired', remaining, plan }
    if (remaining <= 0) return { active: false, reason: 'exhausted', remaining: 0, plan }
    return { active: true, reason: 'active', remaining, plan }
  }

  function injectStyles() {
    const style = document.createElement('style')
    style.textContent = `
      .tracking-box{display:none!important}
      .oracle-base-price{margin:0 0 18px;padding:14px 18px;border:1px solid rgba(201,168,76,.3);border-radius:16px;background:rgba(255,255,255,.6);display:flex;align-items:center;justify-content:space-between;gap:18px}.oracle-base-price span{font-size:12px;color:#756f81;line-height:1.45}.oracle-base-price strong{font:400 25px Georgia,serif;color:#1a1535;white-space:nowrap}.oracle-base-price b{color:#c9a84c;font-weight:400}
      .follow-offer{display:none;margin-top:18px;padding:26px;border:2px solid rgba(201,168,76,.45);border-radius:22px;background:linear-gradient(135deg,rgba(201,168,76,.13),rgba(255,255,255,.94));box-shadow:0 8px 28px rgba(26,21,53,.05)}.follow-offer.visible{display:block}.follow-kicker{font-size:11px;text-transform:uppercase;letter-spacing:.17em;color:#c9a84c}.follow-head{display:flex;align-items:start;justify-content:space-between;gap:20px;margin-top:8px}.follow-head h3{margin:0;font:400 23px Georgia,serif;line-height:1.25}.follow-price{font:400 28px Georgia,serif;white-space:nowrap}.follow-copy{margin:10px 0 0;color:#5f5968;font-size:13px;line-height:1.65}.follow-benefits{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:17px}.follow-benefit{padding:12px;border:1px solid rgba(201,168,76,.25);border-radius:13px;background:rgba(255,255,255,.72);font-size:12px;line-height:1.45}.follow-benefit b{display:block;color:#c9a84c;font-weight:400;margin-bottom:3px}.follow-offer button{margin-top:16px}.follow-note{text-align:center;margin-top:8px;color:#756f81;font-size:10px;line-height:1.45}.follow-active{margin-top:14px;padding:12px 14px;border-left:3px solid #c9a84c;background:rgba(255,255,255,.7);border-radius:0 12px 12px 0;font-size:12px;line-height:1.55;color:#4f495b}
      .history-item button[disabled]{opacity:.55;cursor:not-allowed}.history-access{display:block;margin-top:4px;color:#c9a84c;font-size:10px}
      @media(max-width:620px){.oracle-base-price,.follow-head{align-items:flex-start;flex-direction:column}.follow-benefits{grid-template-columns:1fr}.follow-price{font-size:25px}}
    `
    document.head.appendChild(style)
  }

  function mountBasePrice() {
    const form = document.getElementById('form')
    if (!form || document.querySelector('.oracle-base-price')) return
    const box = document.createElement('div')
    box.className = 'oracle-base-price'
    box.innerHTML = `<span><b>CHRONOSPHERE — Tirage instantané</b><br>Lecture complète · tendance · 3 cartes · astrologie · fenêtres d’action · frise · carte partageable</span><strong>${money(BASE_PRICE)} €</strong>`
    form.insertAdjacentElement('beforebegin', box)
  }

  function mountPricingPanel() {
    const act = document.getElementById('act')
    if (!act || pricingPanel) return
    pricingPanel = document.createElement('section')
    pricingPanel.id = 'followOffer'
    pricingPanel.className = 'follow-offer'
    pricingPanel.innerHTML = `
      <span class="follow-kicker">Option de suivi</span>
      <div class="follow-head">
        <h3>Cette question compte vraiment pour toi ?</h3>
        <div class="follow-price">+${money(FOLLOW_PRICE)} €</div>
      </div>
      <p class="follow-copy">Conserve cette ligne pendant ${FOLLOW_DAYS} jours et reviens observer son évolution. Le ciel est recalculé à chaque retour et CHRONOSPHERE compare ce qui a changé.</p>
      <div class="follow-benefits">
        <div class="follow-benefit"><b>${FOLLOW_DAYS} jours</b>de suivi sur la même question</div>
        <div class="follow-benefit"><b>${MAX_RETURNS} retours inclus</b>deux nouveaux tirages dans la période</div>
        <div class="follow-benefit"><b>Comparaison automatique</b>tendance, fenêtres, prudence et cartes</div>
      </div>
      <button id="activateFollowPreview" type="button">Activer le suivi ${FOLLOW_DAYS} jours · +${money(FOLLOW_PRICE)} € →</button>
      <div id="followStatus" class="follow-note">Preview privée : ce bouton simule l’activation. Aucun paiement n’est effectué.</div>
    `
    const sharePanel = document.getElementById('sharePanel')
    if (sharePanel) sharePanel.insertAdjacentElement('beforebegin', pricingPanel)
    else act.insertAdjacentElement('afterend', pricingPanel)
    pricingPanel.querySelector('#activateFollowPreview')?.addEventListener('click', activatePreviewPlan)
  }

  function showOfferWhenReady() {
    const tracking = document.querySelector('.tracking-box')
    if (!pricingPanel || !tracking) return
    const isResultReady = tracking.classList.contains('visible')
    pricingPanel.classList.toggle('visible', isResultReady)
    if (isResultReady && pendingResumeLineId) renderActivePlan(pendingResumeLineId)
  }

  function clickHiddenSave() {
    const button = document.getElementById('saveTimelineCheckpoint')
    if (!button) return false
    button.click()
    return true
  }

  function activatePreviewPlan() {
    const status = pricingPanel?.querySelector('#followStatus')
    if (status) status.textContent = 'Activation du suivi Preview…'
    if (!clickHiddenSave()) {
      if (status) status.textContent = 'Le point de départ du tirage n’est pas encore disponible.'
      return
    }

    setTimeout(() => {
      const history = loadHistory()
      const snapshot = history[0]
      const lineId = lineIdFor(snapshot)
      if (!lineId) {
        if (status) status.textContent = 'Le point de départ n’a pas pu être conservé.'
        return
      }
      const now = new Date()
      const expiresAt = new Date(now.getTime() + FOLLOW_DAYS * DAY_MS).toISOString()
      const plans = loadPlans()
      plans[lineId] = {
        version: 1,
        product: 'chronosphere-follow-90',
        priceEur: FOLLOW_PRICE,
        activatedAt: now.toISOString(),
        expiresAt,
        maxReturns: MAX_RETURNS,
        usedReturns: 0,
        paymentState: 'preview-simulated',
      }
      if (!savePlans(plans)) {
        if (status) status.textContent = 'Le navigateur n’a pas permis d’activer le suivi.'
        return
      }
      pendingResumeLineId = lineId
      renderActivePlan(lineId)
      gateHistoryButtons()
    }, 120)
  }

  function renderActivePlan(lineId) {
    if (!pricingPanel || !lineId) return
    const state = planState(lineId)
    const button = pricingPanel.querySelector('#activateFollowPreview')
    const status = pricingPanel.querySelector('#followStatus')
    if (!state.plan) return

    if (state.active) {
      if (button) {
        button.disabled = true
        button.textContent = `Suivi activé · ${state.remaining} retour${state.remaining > 1 ? 's' : ''} restant${state.remaining > 1 ? 's' : ''}`
      }
      if (status) status.innerHTML = `<div class="follow-active"><strong>Suivi actif jusqu’au ${esc(formatDate(state.plan.expiresAt))}</strong><br>${state.remaining} retour${state.remaining > 1 ? 's' : ''} encore disponible${state.remaining > 1 ? 's' : ''} sur cette ligne.</div>`
      return
    }

    if (button) {
      button.disabled = true
      button.textContent = state.reason === 'expired' ? 'Suivi arrivé à échéance' : 'Les 2 retours ont été utilisés'
    }
    if (status) status.textContent = state.reason === 'expired' ? `Le suivi de ${FOLLOW_DAYS} jours est terminé.` : 'Cette ligne a utilisé ses deux retours inclus.'
  }

  function gateHistoryButtons() {
    const history = loadHistory()
    const byId = new Map(history.map(item => [item.id, item]))
    document.querySelectorAll('#historyList [data-resume]').forEach(button => {
      const snapshot = byId.get(button.dataset.resume)
      const lineId = lineIdFor(snapshot)
      const state = planState(lineId)
      button.disabled = !state.active
      if (state.active) {
        button.textContent = `Revenir · ${state.remaining}/${state.plan.maxReturns || MAX_RETURNS}`
        button.title = `Suivi actif jusqu’au ${formatDate(state.plan.expiresAt)}`
      } else if (state.reason === 'expired') {
        button.textContent = 'Suivi expiré'
      } else if (state.reason === 'exhausted') {
        button.textContent = '2 retours utilisés'
      } else {
        button.textContent = 'Suivi non activé'
      }

      const meta = button.closest('.history-item')?.querySelector('.meta')
      if (meta && !meta.querySelector('.history-access')) {
        const label = document.createElement('span')
        label.className = 'history-access'
        label.textContent = state.active ? `Suivi actif · ${state.remaining} retour${state.remaining > 1 ? 's' : ''}` : 'Option de suivi requise'
        meta.appendChild(label)
      } else if (meta?.querySelector('.history-access')) {
        meta.querySelector('.history-access').textContent = state.active ? `Suivi actif · ${state.remaining} retour${state.remaining > 1 ? 's' : ''}` : 'Option de suivi requise'
      }
    })
  }

  function consumeReturn(lineId) {
    if (!lineId) return
    const plans = loadPlans()
    const plan = plans[lineId]
    const state = planState(lineId)
    if (!plan || !state.active) return
    plan.usedReturns = Math.min(Number(plan.maxReturns) || MAX_RETURNS, (Number(plan.usedReturns) || 0) + 1)
    plans[lineId] = plan
    savePlans(plans)
    renderActivePlan(lineId)
    gateHistoryButtons()
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('#historyList [data-resume]')
    if (!button || button.disabled) return
    const snapshot = loadHistory().find(item => item.id === button.dataset.resume)
    const lineId = lineIdFor(snapshot)
    const state = planState(lineId)
    if (!state.active) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    pendingResumeLineId = lineId
    setTimeout(() => renderActivePlan(lineId), 0)
  }, true)

  window.fetch = async function chronospherePricingFetch(input, init) {
    const response = await originalFetch(input, init)
    try {
      const url = typeof input === 'string' ? input : input?.url || ''
      const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase()
      if (method === 'POST' && url.includes('/api/oracle-interpret') && response.ok && pendingResumeLineId) {
        const lineId = pendingResumeLineId
        const state = planState(lineId)
        if (state.active) {
          setTimeout(() => {
            clickHiddenSave()
            consumeReturn(lineId)
          }, 320)
        }
      }
    } catch (error) {
      console.error('[chronosphere-pricing] follow-up capture failed', error)
    }
    return response
  }

  function observeUi() {
    const root = document.body
    const observer = new MutationObserver(() => {
      if (!mounted) attemptMount()
      showOfferWhenReady()
      gateHistoryButtons()
    })
    observer.observe(root, { attributes: true, childList: true, subtree: true })
  }

  function attemptMount() {
    if (mounted) return
    const form = document.getElementById('form')
    const act = document.getElementById('act')
    if (!form || !act) return
    injectStyles()
    mountBasePrice()
    mountPricingPanel()
    mounted = true
    showOfferWhenReady()
    gateHistoryButtons()
  }

  function init() {
    attemptMount()
    observeUi()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
