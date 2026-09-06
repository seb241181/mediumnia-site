const RESUME_BASE_URL = 'https://mediumia.fr/chronosphere'
const PACK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/

export function normalizeChronospherePackToken(value) {
  const token = typeof value === 'string' ? value.trim() : ''
  return PACK_TOKEN_PATTERN.test(token) ? token : null
}

export function parseChronosphereResumeHash(hash) {
  const value = typeof hash === 'string' ? hash : ''
  if (!value.startsWith('#resume=')) return null
  return normalizeChronospherePackToken(value.slice('#resume='.length))
}

export function buildChronosphereResumeUrl(packToken) {
  const token = normalizeChronospherePackToken(packToken)
  return token ? `${RESUME_BASE_URL}#resume=${token}` : null
}

export function chronosphereUrlWithoutFragment(location) {
  const pathname = typeof location?.pathname === 'string' ? location.pathname : '/chronosphere'
  const search = typeof location?.search === 'string' ? location.search : ''
  return `${pathname}${search}`
}

export function resolveChronosphereResumeStatus(ok, data) {
  const creditsRemaining = Number(data?.creditsRemaining)
  const creditsTotal = Number(data?.creditsTotal)

  if (ok && data?.valid === true && Number.isInteger(creditsRemaining) && creditsRemaining >= 1) {
    return {
      kind: 'active',
      creditsRemaining,
      creditsTotal: Number.isInteger(creditsTotal) ? creditsTotal : 3,
      status: data.status || 'active',
    }
  }
  if (ok && data?.valid === true && Number.isInteger(creditsRemaining) && creditsRemaining < 1) {
    return {
      kind: 'exhausted',
      creditsRemaining: 0,
      creditsTotal: Number.isInteger(creditsTotal) ? creditsTotal : 3,
      status: data.status || 'exhausted',
    }
  }
  return { kind: 'invalid' }
}
