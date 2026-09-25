// Défi Intuition : logique du jeu, sans interface (testable).
// Chaque jour, 3 manches ; à chaque manche, l'Étoile est cachée sous l'une des
// 5 cartes AVANT le choix du joueur. Le hasard trouve donc 1 carte sur 5.

export const ROUNDS = 3
export const CARDS = 5
export const CHANCE_RATE = 1 / CARDS
export const STORAGE_KEY = 'mediumia_defi_intuition_v1'
export const SHARE_URL = 'https://mediumia.fr/defi-intuition'

// Unbiased draw in [0, n) from the browser's secure random source.
export function secureIndex(n, getRandomValues = (a) => globalThis.crypto.getRandomValues(a)) {
  const limit = Math.floor(0x100000000 / n) * n
  const buf = new Uint32Array(1)
  do { getRandomValues(buf) } while (buf[0] >= limit)
  return buf[0] % n
}

// Day of play, in Paris time (the daily challenge changes at midnight in France).
export function parisDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function previousDay(day) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function emptyState() {
  return { days: {} }
}

export function loadState(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null')
    if (parsed && typeof parsed.days === 'object' && parsed.days) return parsed
  } catch { /* stockage indisponible ou illisible */ }
  return emptyState()
}

export function saveState(storage, state) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* navigation privée */ }
}

// Records today's finished challenge once; replays the same day are practice only.
export function recordDay(state, day, hits) {
  if (state.days[day]) return state
  return { ...state, days: { ...state.days, [day]: { hits: hits.slice(0, ROUNDS).map(Boolean) } } }
}

export function stats(state, today) {
  const entries = Object.entries(state.days)
  const rounds = entries.reduce((n, [, d]) => n + d.hits.length, 0)
  const found = entries.reduce((n, [, d]) => n + d.hits.filter(Boolean).length, 0)
  let streak = 0
  let day = state.days[today] ? today : previousDay(today)
  while (state.days[day]) { streak += 1; day = previousDay(day) }
  const best = entries.reduce((m, [, d]) => Math.max(m, d.hits.filter(Boolean).length), 0)
  return { daysPlayed: entries.length, rounds, found, rate: rounds ? found / rounds : 0, streak, best }
}

export function scoreMessage(score) {
  if (score >= 3) return 'Trois Étoiles sur trois : une intuition remarquable aujourd’hui ! Notez ce que vous ressentiez au moment de choisir.'
  if (score === 2) return 'Deux Étoiles : bien au-dessus du hasard. Votre ressenti était là.'
  if (score === 1) return 'Une Étoile trouvée : mieux que le hasard, qui n’en trouve qu’une tous les deux jours environ.'
  return 'Journée brouillée : ça arrive à tout le monde. Revenez demain, l’esprit plus léger.'
}

// First game ever on this phone: counted once as a new player.
export function isNewPlayer(state) {
  return !state.counted && Object.keys(state.days).length === 0
}

export function shareText(day, hits) {
  const [y, m, d] = day.split('-')
  const score = hits.filter(Boolean).length
  return [
    `🔮 Défi Intuition MediumIA · ${d}/${m}/${y}`,
    `${hits.map((h) => (h ? '🌟' : '🌑')).join('')} ${score}/${ROUNDS}`,
    `Le hasard trouve 1 carte sur ${CARDS}. Et vous ?`,
    SHARE_URL,
  ].join('\n')
}
