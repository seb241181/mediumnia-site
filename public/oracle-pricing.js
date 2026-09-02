(() => {
  if (!document.querySelector('script[data-chronosphere-pricing-v2]')) {
    const script = document.createElement('script')
    script.src = '/oracle-pricing-v2.js'
    script.dataset.chronospherePricingV2 = 'true'
    document.head.appendChild(script)
  }

  if (!document.querySelector('script[data-chronosphere-pricing-clarity]')) {
    const clarity = document.createElement('script')
    clarity.src = '/oracle-pricing-clarity.js'
    clarity.dataset.chronospherePricingClarity = 'true'
    document.head.appendChild(clarity)
  }
})()
