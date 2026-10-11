// Simulation en mémoire : identifiants stables, aucun stockage ni échange distant.
const CLOSE_IDS = ['aurore', 'nuage', 'plume', 'chemin']
const ENCOUNTER_IDS = ['lune', 'sentier', 'phare', 'sauge', 'maree', 'ambre', 'bois']
const known = id => [...CLOSE_IDS, ...ENCOUNTER_IDS].includes(id)
export const isCloseContact = id => CLOSE_IDS.includes(id)
export const canMessage = (state, id) => known(id) && !state.blocked.includes(id) && state.consent[id] === 'accepted'
export const canLueur = (state, id, recipientAllows) => canMessage(state, id) && isCloseContact(id) && recipientAllows === true
export function initialSocialState() {
  return { blocked: [], consent: { aurore: 'pending' }, encounters: [], threads: { aurore: [{ who: 'them', text: 'Bonsoir ! Je voudrais parler des rêves, si vous en avez envie.' }, { who: 'them', text: 'Aucune urgence, on peut prendre notre temps ✧' }] } }
}
export function socialReducer(state, action) {
  const id = action.id
  if (action.type === 'SET_BLOCKED') {
    const next = typeof action.update === 'function' ? action.update(state.blocked) : action.update
    const blocked = [...new Set(next.filter(known))]
    const newlyBlocked = blocked.filter(item => !state.blocked.includes(item))
    return { ...state, blocked, consent: Object.fromEntries(Object.entries(state.consent).filter(([key]) => !newlyBlocked.includes(key))), threads: Object.fromEntries(Object.entries(state.threads).filter(([key]) => !newlyBlocked.includes(key))), encounters: state.encounters.filter(key => !newlyBlocked.includes(key)) }
  }
  if (!known(id) || state.blocked.includes(id)) return state
  if (action.type === 'ACCEPT') {
    if (isCloseContact(id) && !['pending', 'ignored', 'refused'].includes(state.consent[id])) return state
    return { ...state, consent: { ...state.consent, [id]: 'accepted' }, encounters: isCloseContact(id) ? state.encounters : [...new Set([...state.encounters, id])] }
  }
  if (action.type === 'ANSWER' && ['ignored', 'refused', 'pending'].includes(action.status) && ['pending', 'ignored', 'refused'].includes(state.consent[id])) return { ...state, consent: { ...state.consent, [id]: action.status } }
  if (action.type === 'SEND' && canMessage(state, id) && action.text.trim()) return { ...state, threads: { ...state.threads, [id]: [...(state.threads[id] || []), { who: 'me', text: action.text.trim().slice(0, 240) }] } }
  return state
}
