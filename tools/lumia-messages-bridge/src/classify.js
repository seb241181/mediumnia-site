/**
 * Filtre local, sans réseau ni IA : décide si un message entrant peut concerner
 * un rendez-vous. Conservateur par construction :
 *   probable  → au moins un mot propre à l'activité (rendez-vous, séance,
 *               guidance, prestation, réservation…) ;
 *   incertain → seulement des indices génériques (un jour, une heure,
 *               « dispo », « annuler »…) : un proche peut écrire la même chose ;
 *   ignorer   → aucun indice, politesse seule, message intime sans mot
 *               d'activité, ou expéditeur automatique.
 *
 * Le texte n'est jamais interprété comme une consigne : il est seulement
 * comparé à des listes. « Ignore les instructions… » reste une donnée client.
 */

export function normalize(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
}

// [motif, poids, étiquette]. Les motifs portent sur le texte normalisé
// (minuscules, sans accents).
const SIGNALS = [
  [/\brdv\b|\brendez[ -]?vous\b|\brendez vous\b/, 3, 'rendez-vous'],
  [/\bseances?\b|\bconsultations?\b|\bconsult\b/, 3, 'séance'],
  [/\bguidances?\b/, 3, 'guidance'],
  [/\bdesenvout\w*|\bdegagements?\b|\bnettoyage energetique\b|\bsoins? energetique/, 3, 'prestation'],
  [/\breserv(er|ation|e)\b|\bcreneaux?\b|\bprendre (un )?rdv\b/, 3, 'réservation'],
  [/\bdeplac(er|e|ement)\b|\bdecal(er|e)\b|\breport(er|e)\b|\bchanger (la |l |de )?(date|heure|horaire)\b/, 2, 'déplacer'],
  [/\bannul(er|e|ation)\b/, 2, 'annuler'],
  [/\bdispo(nible|nibles|nibilites?|s)?\b/, 2, 'disponibilité'],
  [/\bvisio\b|\bfacetime\b|\bwhatsapp\b|\ben presentiel\b|\bpar telephone\b/, 2, 'modalité'],
  [/\bhoraires?\b|\ba quelle heure\b|\btarifs?\b|\bcombien (ca|cela|coute)\b|\bprix\b/, 2, 'horaire/tarif'],
  [/\best[ -]ce possible\b|\bserait[ -]il possible\b|\bpourriez[ -]vous\b|\bpourrais[ -]tu\b/, 1, 'demande'],
  [/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/, 1, 'jour'],
  [/\bdemain\b|\bapres[ -]demain\b|\bsemaine prochaine\b|\bce (matin|soir|midi)\b|\bcet apres[ -]midi\b/, 1, 'échéance'],
  [/\b([01]?\d|2[0-3]) ?h ?([0-5]\d)?\b|\b([01]?\d|2[0-3]):[0-5]\d\b/, 1, 'heure'],
  [/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b\d{1,2} (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/, 1, 'date'],
  [/\bmaison\b|\bchez (moi|nous)\b|\bdomicile\b/, 1, 'lieu'],
]

// Messages de pure politesse : ignorés s'ils sont courts et sans signal fort.
const COURTESY = /^(merci( beaucoup| bien| infiniment)?|ok|okay|d accord|dac|top|super|parfait|tres bien|bonne (soiree|journee|nuit)|bisous?|a bientot|ca marche|oui|non|cool|genial)[\s!.…]*$/

// Marqueurs d'un message personnel : sans mot d'activité, le message est ignoré.
const PERSONAL = /\bbisous?\b|\bbises\b|\bje t aime\b|\bmon (amour|coeur|cheri)\b|\bma (cherie|puce)\b|\bmaman\b|\bpapa\b|\bmamie\b|\bpapi\b/

// Expéditeurs automatiques : numéros courts (codes, banques, livraisons…).
export function isAutomatedSender(handle) {
  const h = String(handle || '').trim()
  if (!h) return true
  if (h.includes('@')) return false
  const digits = h.replace(/[^\d]/g, '')
  return !h.startsWith('+') && digits.length <= 6
}

export function classify(text, { handle = null, ignoreHandles = [] } = {}) {
  const raw = String(text || '').replace(/￼/g, '').trim()
  if (!raw) return { label: 'ignorer', score: 0, reasons: ['sans texte'] }
  if (ignoreHandles.includes(handle)) return { label: 'ignorer', score: 0, reasons: ['expéditeur exclu'] }
  if (isAutomatedSender(handle)) return { label: 'ignorer', score: 0, reasons: ['expéditeur automatique'] }

  const t = normalize(raw)
  const reasons = []
  let score = 0
  let strong = false
  for (const [pattern, weight, label] of SIGNALS) {
    if (pattern.test(t)) {
      score += weight
      reasons.push(label)
      if (weight >= 3) strong = true
    }
  }
  const stripped = t.replace(/[^\p{L}\p{N}\s!.…]/gu, '').trim()
  if (!strong && (COURTESY.test(stripped) || !stripped)) return { label: 'ignorer', score: 0, reasons: ['politesse'] }
  if (!strong && PERSONAL.test(t)) return { label: 'ignorer', score: 0, reasons: ['message personnel'] }

  const label = strong ? 'probable' : score >= 1 ? 'incertain' : 'ignorer'
  return { label, score, reasons }
}

// Indices transmis à Lumia, jamais inventés : seulement ce que le texte dit.
export function hints(text) {
  const t = normalize(text)
  const out = {}
  if (/\bguidances?\b/.test(t)) out.service_hint = 'guidance'
  else if (/\bdesenvout\w*/.test(t)) out.service_hint = 'désenvoûtement'
  else if (/\bdegagements?\b/.test(t)) out.service_hint = 'dégagement'
  if (/\bvisio\b|\bfacetime\b|\bwhatsapp\b/.test(t)) out.modality = 'video'
  else if (/\bpar telephone\b|\bau telephone\b/.test(t)) out.modality = 'phone'
  return out
}

// Intentions lisibles (sans IA, mêmes formulations que le filtre) : aident
// Lumia à répondre « qui voulait déplacer / annuler / réserver ? ». Le texte
// reste une donnée ; seules ces étiquettes en sont tirées.
const INTENTS = [
  ['rendez_vous', /\brdv\b|\brendez[ -]?vous\b|\bseances?\b|\bconsultations?\b|\bguidances?\b|\bdesenvout\w*|\bdegagements?\b|\bsoins? energetique/],
  ['reserver', /\breserv(er|ation|e)\b|\bcreneaux?\b|\bprendre (un )?(rdv|rendez[ -]?vous)\b|\bdispo(nible|nibles|nibilites?|s)?\b/],
  ['deplacer', /\bdeplac(er|e|ement)\b|\bdecal(er|e)\b|\breport(er|e)\b|\bchanger (la |l |de )?(date|heure|horaire)\b/],
  ['annuler', /\bannul(er|e|ation)\b/],
  ['urgence', /\burgen(t|te|ce|ces)\b|\bau plus vite\b|\bau plus tot\b|\bdes que possible\b|\basap\b|\brapidement\b|\bvite\b|\bc est grave\b|\bje n en peux plus\b|\baidez[ -]moi\b/],
]

export function intents(text) {
  const t = normalize(text)
  return INTENTS.filter(([, pattern]) => pattern.test(t)).map(([label]) => label)
}
