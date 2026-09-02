(() => {
  const HISTORY_KEY = 'chronosphere999:timeline-history:v1'
  const PLAN_KEY = 'chronosphere999:follow-plans:v2'
  const BASE_PRICE = 5
  const FOLLOW_PRICE = 7.90
  const FOLLOW_DAYS = 90
  const MAX_RETURNS = 2
  const API = '/api/oracle-interpret'

  let pricingPanel = null
  let pendingPurchaseLineId = null
  let pendingResume = null
  let verifiedResumeClickId = null
  let followSubmissionArmed = null
  let finalizingReturn = false
  let paypalPromise = null
  let refreshTimer = null
  let uiTimer = null
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
      console.error('[chronosphere-pricing] storage failed', error)
      return false
    }
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

  function planCache(lineId) {
    return loadPlans()[lineId] || null
  }

  function storeServerPlan(lineId, followToken, plan) {
    if (!lineId || !followToken || !plan) return false
    const plans = loadPlans()
    plans[lineId] = {
      version: 2,
      product: 'chronosphere-follow-90',
      paymentState: 'server-verified-sandbox',
      followToken,
      plan,
      cachedAt: new Date().toISOString(),
    }
    return savePlans(plans)
  }

  async function jsonFetch(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`)
      error.payload = data
      throw error
    }
    return data
  }

  function injectStyles() {
    const style = document.createElement('style')
    style.textContent = `
      .tracking-box{display:none!important}
      .oracle-base-price{margin:0 0 18px;padding:14px 18px;border:1px solid rgba(201,168,76,.3);border-radius:16px;background:rgba(255,255,255,.6);display:flex;align-items:center;justify-content:space-between;gap:18px}.oracle-base-price span{font-size:12px;color:#756f81;line-height:1.45}.oracle-base-price strong{font:400 25px Georgia,serif;color:#1a1535;white-space:nowrap}.oracle-base-price b{color:#c9a84c;font-weight:400}
      .follow-offer{display:none;margin-top:18px;padding:26px;border:2px solid rgba(201,168,76,.45);border-radius:22px;background:linear-gradient(135deg,rgba(201,168,76,.13),rgba(255,255,255,.94));box-shadow:0 8px 28px rgba(26,21,53,.05)}.follow-offer.visible{display:block}.follow-kicker{font-size:11px;text-transform:uppercase;letter-spacing:.17em;color:#c9a84c}.follow-head{display:flex;align-items:start;justify-content:space-between;gap:20px;margin-top:8px}.follow-head h3{margin:0;font:400 23px Georgia,serif;line-height:1.25}.follow-price{font:400 28px Georgia,serif;white-space:nowrap}.follow-copy{margin:10px 0 0;color:#5f5968;font-size:13px;line-height:1.65}.follow-benefits{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:17px}.follow-benefit{padding:12px;border:1px solid rgba(201,168,76,.25);border-radius:13px;background:rgba(255,255,255,.72);font-size:12px;line-height:1.45}.follow-benefit b{display:block;color:#c9a84c;font-weight:400;margin-bottom:3px}.follow-offer button{margin-top:16px}.follow-note{text-align:center;margin-top:9px;color:#756f81;font-size:10px;line-height:1.5}.follow-active{margin-top:14px;padding:13px 15px;border-left:3px solid #c9a84c;background:rgba(255,255,255,.72);border-radius:0 12px 12px 0;font-size:12px;line-height:1.55;color:#4f495b}.paypal-follow-wrap{display:none;margin-top:17px;padding-top:16px;border-top:1px solid rgba(201,168,76,.28)}.paypal-follow-wrap.visible{display:block}.paypal-sandbox-badge{display:inline-block;margin-bottom:10px;padding:6px 9px;border-radius:999px;background:#1a1535;color:#d8b567;font:700 10px system-ui,sans-serif;letter-spacing:.08em}.follow-error{margin-top:10px;color:#b42318;font:12px system-ui,sans-serif;text-align:center}
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
      <button id="prepareFollowPayment" type="button">Activer le suivi ${FOLLOW_DAYS} jours · +${money(FOLLOW_PRICE)} € →</button>
      <div id="paypalFollowWrap" class="paypal-follow-wrap">
        <span class="paypal-sandbox-badge">PAYPAL SANDBOX · AUCUN ARGENT RÉEL</span>
        <div id="paypalFollowButtons"></div>
        <div id="followPaymentError" class="follow-error"></div>
      </div>
      <div id="followStatus" class="follow-note">Preview privée : le paiement de suivi utilise PayPal Sandbox. Aucun moyen de paiement réel n’est débité.</div>
    `
    const sharePanel = document.getElementById('sharePanel')
    if (sharePanel) sharePanel.insertAdjacentElement('beforebegin', pricingPanel)
    else act.insertAdjacentElement('afterend', pricingPanel)
    pricingPanel.querySelector('#prepareFollowPayment')?.addEventListener('click', preparePayPal)
  }

  function clickHiddenSave() {
    const button = document.getElementById('saveTimelineCheckpoint')
    if (!button) return false
    button.click()
    return true
  }

  function ensureCurrentLine() {
    if (pendingPurchaseLineId) return pendingPurchaseLineId
    if (!clickHiddenSave()) return null
    const snapshot = loadHistory()[0]
    const lineId = lineIdFor(snapshot)
    if (!lineId || !/^[0-9a-f-]{36}$/i.test(lineId)) return null
    pendingPurchaseLineId = lineId
    return lineId
  }

  function loadPayPal(clientId) {
    if (window.paypal?.Buttons) return Promise.resolve()
    if (paypalPromise) return paypalPromise
    paypalPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=capture&components=buttons&enable-funding=paylater`
      script.dataset.chronospherePaypal = 'true'
      script.onload = resolve
      script.onerror = () => reject(new Error('paypal_sdk_load_failed'))
      document.head.appendChild(script)
    })
    return paypalPromise
  }

  async function preparePayPal() {
    const button = pricingPanel?.querySelector('#prepareFollowPayment')
    const wrap = pricingPanel?.querySelector('#paypalFollowWrap')
    const errorBox = pricingPanel?.querySelector('#followPaymentError')
    const status = pricingPanel?.querySelector('#followStatus')
    if (!button || !wrap || !errorBox) return

    button.disabled = true
    errorBox.textContent = ''
    if (status) status.textContent = 'Préparation du paiement Sandbox…'

    try {
      const lineId = ensureCurrentLine()
      if (!lineId) throw new Error('line_checkpoint_unavailable')
      const cfg = await jsonFetch(`${API}?followAction=config`)
      await loadPayPal(cfg.clientId)
      if (!window.paypal?.Buttons) throw new Error('paypal_buttons_unavailable')

      wrap.classList.add('visible')
      button.style.display = 'none'
      const container = pricingPanel.querySelector('#paypalFollowButtons')
      container.innerHTML = ''

      await window.paypal.Buttons({
        style: { layout: 'vertical', shape: 'rect', label: 'paypal' },
        createOrder: async () => {
          if (status) status.textContent = 'Création de la commande Sandbox à 7,90 €…'
          const order = await jsonFetch(`${API}?followAction=create`, {
            method: 'POST',
            body: JSON.stringify({ lineId }),
          })
          return order.id
        },
        onApprove: async data => {
          if (status) status.textContent = 'Paiement Sandbox approuvé. Vérification serveur et activation…'
          const result = await jsonFetch(`${API}?followAction=capture`, {
            method: 'POST',
            body: JSON.stringify({ lineId, orderId: data.orderID }),
          })
          if (!result.followToken || !result.plan) throw new Error('follow_activation_incomplete')
          storeServerPlan(lineId, result.followToken, result.plan)
          renderActivePlan(lineId, result.plan)
          scheduleGateRefresh(0)
        },
        onCancel: () => {
          if (status) status.textContent = 'Paiement Sandbox annulé. Le suivi n’a pas été activé.'
        },
        onError: error => {
          console.error('[chronosphere-paypal]', error)
          errorBox.textContent = 'Le paiement Sandbox n’a pas abouti. Aucun argent réel n’est concerné.'
          if (status) status.textContent = 'Le suivi reste inactif.'
        },
      }).render('#paypalFollowButtons')

      if (status) status.textContent = 'PayPal Sandbox est prêt. Ce test reproduit le futur achat à 7,90 € sans débit réel.'
    } catch (error) {
      console.error('[chronosphere-pricing] prepare PayPal', error)
      errorBox.textContent = error.message === 'follow_line_already_registered'
        ? 'Cette ligne possède déjà un suivi serveur.'
        : 'Impossible de préparer PayPal Sandbox pour le moment.'
      button.disabled = false
      if (status) status.textContent = 'Aucun paiement n’a été effectué.'
    }
  }

  function normalizedServerPlan(data, fallback = {}) {
    if (!data) return fallback
    return {
      status: data.plan_status || data.status || fallback.status || 'unknown',
      active: (data.plan_status || data.status) === 'active' && Number(data.remaining) > 0,
      lineId: data.lineId || fallback.lineId || null,
      activatedAt: data.activatedAt || fallback.activatedAt || null,
      expiresAt: data.expiresAt || data.expires_at || fallback.expiresAt || null,
      maxReturns: Number(data.maxReturns ?? data.max_returns ?? fallback.maxReturns ?? MAX_RETURNS),
      usedReturns: Number(data.usedReturns ?? data.used_returns ?? fallback.usedReturns ?? 0),
      remaining: Number(data.remaining ?? fallback.remaining ?? 0),
      product: data.product || fallback.product || 'chronosphere-follow-90',
    }
  }

  async function fetchServerPlan(lineId) {
    const cached = planCache(lineId)
    if (!cached?.followToken) return null
    try {
      const result = await jsonFetch(`${API}?followAction=status`, {
        method: 'POST',
        body: JSON.stringify({ lineId, followToken: cached.followToken }),
      })
      const plan = normalizedServerPlan(result.plan, cached.plan)
      storeServerPlan(lineId, cached.followToken, plan)
      return { plan, followToken: cached.followToken }
    } catch (error) {
      console.warn('[chronosphere-pricing] status', error.message)
      return null
    }
  }

  function renderActivePlan(lineId, planInput = null) {
    if (!pricingPanel || !lineId) return
    const cached = planCache(lineId)
    const plan = normalizedServerPlan(planInput || cached?.plan)
    const button = pricingPanel.querySelector('#prepareFollowPayment')
    const wrap = pricingPanel.querySelector('#paypalFollowWrap')
    const status = pricingPanel.querySelector('#followStatus')
    if (!cached?.followToken || !plan?.expiresAt) return

    const renderKey = `${lineId}|${plan.status}|${plan.remaining}|${plan.expiresAt}`
    if (pricingPanel.dataset.planRenderKey === renderKey) return
    pricingPanel.dataset.planRenderKey = renderKey

    button.style.display = ''
    button.disabled = true
    wrap.classList.remove('visible')

    if (plan.status === 'active' && plan.remaining > 0) {
      button.textContent = `Suivi activé · ${plan.remaining} retour${plan.remaining > 1 ? 's' : ''} restant${plan.remaining > 1 ? 's' : ''}`
      status.innerHTML = `<div class="follow-active"><strong>Suivi serveur actif jusqu’au ${formatDate(plan.expiresAt)}</strong><br>${plan.remaining} retour${plan.remaining > 1 ? 's' : ''} encore disponible${plan.remaining > 1 ? 's' : ''} sur cette ligne. Le compteur est vérifié côté serveur.</div>`
    } else {
      button.textContent = plan.status === 'expired' ? 'Suivi arrivé à échéance' : 'Les 2 retours ont été utilisés'
      status.innerHTML = `<div class="follow-active"><strong>${plan.status === 'expired' ? 'Suivi terminé' : 'Ligne suivie complète'}</strong><br>${plan.status === 'expired' ? 'La période de 90 jours est arrivée à échéance.' : 'Les deux retours inclus ont été utilisés.'}</div>`
    }
  }

  function snapshotByButton(button) {
    const id = button?.dataset?.resume
    if (!id) return null
    return loadHistory().find(item => item.id === id) || null
  }

  function cachedAccessLabel(lineId) {
    const cached = planCache(lineId)
    if (!cached?.followToken) return { enabled: false, text: 'Option de suivi requise' }
    const plan = normalizedServerPlan(cached.plan)
    const notExpired = plan.expiresAt && new Date(plan.expiresAt).getTime() > Date.now()
    const enabled = plan.status === 'active' && plan.remaining > 0 && notExpired
    return {
      enabled,
      text: enabled ? `Suivi serveur · ${plan.remaining} retour${plan.remaining > 1 ? 's' : ''}` : (plan.status === 'expired' ? 'Suivi expiré' : 'Suivi terminé'),
    }
  }

  function gateHistoryButtons() {
    document.querySelectorAll('#historyList [data-resume]').forEach(button => {
      const snapshot = snapshotByButton(button)
      const lineId = lineIdFor(snapshot)
      const access = cachedAccessLabel(lineId)
      const desiredDisabled = !access.enabled
      const desiredText = access.enabled ? `Revenir · ${access.text.match(/\d+/)?.[0] || ''}/${MAX_RETURNS}` : access.text
      if (button.disabled !== desiredDisabled) button.disabled = desiredDisabled
      if (button.textContent !== desiredText) button.textContent = desiredText

      const meta = button.closest('.history-item')?.querySelector('.meta')
      if (!meta) return
      let label = meta.querySelector('.history-access')
      if (!label) {
        label = document.createElement('span')
        label.className = 'history-access'
        meta.appendChild(label)
      }
      if (label.textContent !== access.text) label.textContent = access.text
    })
  }

  async function refreshVisiblePlans() {
    const seen = new Set()
    const lineIds = []
    document.querySelectorAll('#historyList [data-resume]').forEach(button => {
      const lineId = lineIdFor(snapshotByButton(button))
      if (lineId && !seen.has(lineId) && planCache(lineId)?.followToken) {
        seen.add(lineId)
        lineIds.push(lineId)
      }
    })
    await Promise.all(lineIds.slice(0, 6).map(lineId => fetchServerPlan(lineId)))
    gateHistoryButtons()
  }

  function scheduleGateRefresh(delay = 120) {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      gateHistoryButtons()
      refreshVisiblePlans().catch(() => {})
    }, delay)
  }

  function lockFollowFields(locked) {
    ;['fullName', 'birthDate', 'birthTime', 'birthPlace', 'theme', 'customTheme'].forEach(id => {
      const element = document.getElementById(id)
      if (element) element.disabled = Boolean(locked)
    })
    const notice = document.getElementById('resumeNotice')
    if (notice && locked && !notice.dataset.followLocked) {
      notice.dataset.followLocked = 'true'
      notice.insertAdjacentHTML('beforeend', '<br><strong>Suivi actif :</strong> cette étape reprend exactement la même ligne. Seuls les trois nombres sont à choisir de nouveau.')
    }
    if (notice && !locked) delete notice.dataset.followLocked
  }

  async function verifyAndResume(button) {
    const snapshot = snapshotByButton(button)
    const lineId = lineIdFor(snapshot)
    const cached = planCache(lineId)
    if (!snapshot || !lineId || !cached?.followToken) return

    button.disabled = true
    const original = button.textContent
    button.textContent = 'Vérification du suivi…'

    const verified = await fetchServerPlan(lineId)
    if (!verified?.plan || verified.plan.status !== 'active' || verified.plan.remaining <= 0) {
      button.textContent = 'Suivi indisponible'
      scheduleGateRefresh(0)
      return
    }

    pendingResume = { lineId, followToken: verified.followToken, snapshotId: snapshot.id }
    verifiedResumeClickId = snapshot.id
    button.disabled = false
    button.textContent = original
    button.click()
    setTimeout(() => lockFollowFields(true), 0)
  }

  async function consumeReturn(resume) {
    const result = await jsonFetch(`${API}?followAction=consume`, {
      method: 'POST',
      body: JSON.stringify({ lineId: resume.lineId, followToken: resume.followToken }),
    })
    const cached = planCache(resume.lineId)
    const plan = normalizedServerPlan(result.plan, cached?.plan)
    storeServerPlan(resume.lineId, resume.followToken, plan)
    return plan
  }

  async function finalizeSuccessfulReturn() {
    if (!followSubmissionArmed || finalizingReturn) return
    finalizingReturn = true
    const resume = followSubmissionArmed
    try {
      const plan = await consumeReturn(resume)
      clickHiddenSave()
      renderActivePlan(resume.lineId, plan)
      pendingResume = null
      followSubmissionArmed = null
      lockFollowFields(false)
      scheduleGateRefresh(0)
    } catch (error) {
      console.error('[chronosphere-pricing] consume', error)
      const compare = document.querySelector('.compare-box')
      if (compare) compare.classList.remove('visible')
      const err = document.getElementById('err')
      if (err) err.textContent = 'Le suivi n’a pas pu valider ce retour côté serveur. Aucun nouveau repère n’a été enregistré.'
      followSubmissionArmed = null
      pendingResume = null
      lockFollowFields(false)
      scheduleGateRefresh(0)
    } finally {
      finalizingReturn = false
    }
  }

  function observeSuccessfulReading() {
    const reading = document.getElementById('reading')
    if (!reading) return
    const observer = new MutationObserver(() => {
      if (!followSubmissionArmed || !reading.textContent.trim()) return
      setTimeout(() => finalizeSuccessfulReturn(), 80)
    })
    observer.observe(reading, { childList: true, characterData: true, subtree: true })
  }

  function showOfferWhenReady() {
    const tracking = document.querySelector('.tracking-box')
    if (!pricingPanel || !tracking) return
    const visible = tracking.classList.contains('visible')
    if (pricingPanel.classList.contains('visible') !== visible) pricingPanel.classList.toggle('visible', visible)
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('#historyList [data-resume]')
    if (!button) return
    if (verifiedResumeClickId && button.dataset.resume === verifiedResumeClickId) {
      verifiedResumeClickId = null
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    if (button.disabled) return
    verifyAndResume(button).catch(error => console.error('[chronosphere-pricing] resume', error))
  }, true)

  document.addEventListener('submit', event => {
    if (event.target?.id !== 'form' || !pendingResume) return
    followSubmissionArmed = { ...pendingResume }
  }, true)

  function observeUi() {
    const observer = new MutationObserver(() => {
      clearTimeout(uiTimer)
      uiTimer = setTimeout(() => {
        if (!mounted) attemptMount()
        showOfferWhenReady()
        gateHistoryButtons()
      }, 30)
    })
    observer.observe(document.body, { attributes: true, childList: true, subtree: true })
  }

  function attemptMount() {
    if (mounted) return
    const form = document.getElementById('form')
    const act = document.getElementById('act')
    if (!form || !act) return
    injectStyles()
    mountBasePrice()
    mountPricingPanel()
    observeSuccessfulReading()
    mounted = true
    gateHistoryButtons()
    scheduleGateRefresh(0)
  }

  function init() {
    attemptMount()
    observeUi()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
