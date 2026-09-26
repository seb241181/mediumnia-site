// Réception des rapports CSP (Content-Security-Policy-Report-Only).
// Le navigateur signale ce que la politique aurait bloqué, sans rien bloquer.
// Le journal ne garde que la directive, l'hôte de la ressource et le chemin de
// la page : jamais l'adresse IP, ni les paramètres d'URL (jetons possibles),
// ni le reste du rapport.

const MAX_BODY = 16 * 1024

function hostOf(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (['inline', 'eval', 'data', 'blob', 'self', 'wasm-eval', 'trusted-types-policy'].includes(raw)) return raw
  try { return new URL(raw).host || raw.split(':')[0] } catch { return raw.split(/[/?#]/)[0].slice(0, 80) }
}

function pathOf(value) {
  try { return new URL(String(value || '')).pathname.slice(0, 120) } catch { return '' }
}

function parseBody(body) {
  if (!body) return null
  if (Buffer.isBuffer(body)) body = body.toString('utf8')
  if (typeof body === 'string') {
    if (body.length > MAX_BODY) return null
    try { body = JSON.parse(body) } catch { return null }
  }
  return body && typeof body === 'object' ? body : null
}

// Accepte l'ancien format (report-uri : { "csp-report": {...} }) et le nouveau
// (Reporting API : [{ type: "csp-violation", body: {...} }]).
export function summarizeCspReports(body) {
  const parsed = parseBody(body)
  if (!parsed) return []
  const raw = Array.isArray(parsed)
    ? parsed.filter((r) => r && r.type === 'csp-violation').map((r) => r.body || {})
    : [parsed['csp-report'] || parsed]
  return raw.slice(0, 20).map((r) => ({
    directive: String(r['effective-directive'] || r.effectiveDirective || r['violated-directive'] || r.violatedDirective || '').split(' ')[0].slice(0, 40),
    blocked: hostOf(r['blocked-uri'] || r.blockedURL || r.blockedURI),
    page: pathOf(r['document-uri'] || r.documentURL || r.documentURI),
  })).filter((r) => r.directive)
}

export async function handleCspReport(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  for (const report of summarizeCspReports(req.body)) {
    console.warn('[csp] rapport', JSON.stringify(report))
  }
  return res.status(204).end()
}
