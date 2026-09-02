(() => {
  if (window.__chronospherePricingClarityMounted) return
  window.__chronospherePricingClarityMounted = true

  const FOLLOW_PRICE = '7,90 €'

  function injectStyles() {
    if (document.getElementById('chronosphere-pricing-clarity-style')) return
    const style = document.createElement('style')
    style.id = 'chronosphere-pricing-clarity-style'
    style.textContent = `
      .oracle-option-hint{margin-top:8px;padding-top:8px;border-top:1px solid rgba(201,168,76,.2);font-size:11px!important;color:#756f81!important;line-height:1.45}.oracle-option-hint b{color:#c9a84c!important;font-weight:400!important}
      .follow-price-clarity{margin:12px 0 0;padding:10px 12px;border-radius:12px;background:rgba(26,21,53,.045);font-size:11px;color:#5f5968;line-height:1.5}.follow-price-clarity strong{color:#1a1535;font-weight:600}
    `
    document.head.appendChild(style)
  }

  function enhanceBasePrice() {
    const box = document.querySelector('.oracle-base-price')
    if (!box || box.querySelector('.oracle-option-hint')) return false
    const text = box.querySelector('span')
    if (!text) return false
    const hint = document.createElement('div')
    hint.className = 'oracle-option-hint'
    hint.innerHTML = `Option facultative après le tirage : <b>suivi de la même ligne pendant 90 jours · +${FOLLOW_PRICE}</b>`
    text.appendChild(hint)
    return true
  }

  function enhanceFollowOffer() {
    const panel = document.getElementById('followOffer')
    if (!panel) return false

    const kicker = panel.querySelector('.follow-kicker')
    if (kicker) kicker.textContent = 'Option facultative · après le tirage'

    const copy = panel.querySelector('.follow-copy')
    if (copy && !panel.querySelector('.follow-price-clarity')) {
      const clarity = document.createElement('div')
      clarity.className = 'follow-price-clarity'
      clarity.innerHTML = `<strong>Ton tirage reste à 5 €.</strong> Tu ajoutes ${FOLLOW_PRICE} uniquement si tu souhaites suivre cette même ligne pendant 90 jours avec 2 retours inclus.`
      copy.insertAdjacentElement('afterend', clarity)
    }
    return true
  }

  function enhance() {
    injectStyles()
    enhanceBasePrice()
    enhanceFollowOffer()
  }

  enhance()
  const observer = new MutationObserver(enhance)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  setTimeout(() => observer.disconnect(), 15000)
})()
