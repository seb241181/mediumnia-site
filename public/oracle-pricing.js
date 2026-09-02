(() => {
  if (document.querySelector('script[data-chronosphere-pricing-v2]')) return
  const script = document.createElement('script')
  script.src = '/oracle-pricing-v2.js'
  script.dataset.chronospherePricingV2 = 'true'
  document.head.appendChild(script)
})()
