// Source unique des messages d'erreur montrés aux clients.
//
// Les API renvoient des codes techniques (« capture_failed », « auth_required »…)
// et le navigateur des messages anglais (« Failed to fetch »). Rien de tout cela
// ne doit s'afficher tel quel : ce module les traduit en une phrase claire qui
// dit quoi faire. Une phrase déjà rédigée pour le client (en français, avec des
// espaces) est conservée telle quelle.

const CONTACT = 'contact@mediumia.fr'

export const NETWORK_MESSAGE = 'La connexion a été interrompue. Vérifiez votre connexion internet, puis réessayez.'
export const DEFAULT_MESSAGE = 'Une action n’a pas abouti. Réessayez dans quelques instants.'
export const TIMEOUT_MESSAGE = 'Le service met trop de temps à répondre. Réessayez dans quelques instants.'

const SESSION = 'Votre session a expiré. Reconnectez-vous, puis réessayez.'
const RATE_LIMIT = 'Trop de demandes en peu de temps. Patientez une minute, puis réessayez.'
const UNAVAILABLE = 'Le service est momentanément indisponible. Réessayez dans quelques minutes.'
const PAYMENT_NOT_STARTED = 'Le paiement n’a pas pu être préparé. Aucun montant n’a été prélevé. Réessayez dans quelques instants.'
const PAYMENT_NOT_CONFIRMED = `Le paiement n’a pas pu être confirmé. Si un montant a été prélevé, écrivez-nous à ${CONTACT} : nous rétablissons votre accès.`

const CODES = {
  // Réseau et session
  auth_required: SESSION,
  unauthenticated: SESSION,
  session_expired: SESSION,
  invalid_token: SESSION,

  // Limites
  rate_limit_exceeded: RATE_LIMIT,
  too_many_attempts: RATE_LIMIT,
  oracle_rate_limit_exceeded: RATE_LIMIT,
  usage_limit_reached: 'La limite d’utilisation est atteinte pour le moment. Réessayez plus tard.',

  // Services indisponibles
  supabase_not_configured: UNAVAILABLE,
  db_error: UNAVAILABLE,
  provider_error: UNAVAILABLE,
  empty_provider_response: UNAVAILABLE,
  quota_unavailable: UNAVAILABLE,
  sync_failed: UNAVAILABLE,
  timeline_engine_unavailable: 'Le moteur ChronoSphère est momentanément indisponible. Réessayez dans quelques minutes.',
  timeline_engine_incomplete: 'Le moteur ChronoSphère n’a pas pu terminer la lecture. Réessayez dans quelques minutes.',
  timeline_interpretation_unavailable: 'L’interprétation est momentanément indisponible. Réessayez dans quelques minutes.',
  max_timeline_unavailable: 'Votre suivi MAX est momentanément indisponible. Réessayez dans quelques minutes.',
  max_profile_unavailable: 'Votre suivi MAX est momentanément indisponible. Réessayez dans quelques minutes.',
  max_resume_unavailable: 'Votre suivi MAX est momentanément indisponible. Réessayez dans quelques minutes.',
  max_read_failed: 'La lecture MAX n’a pas pu être générée. Réessayez dans quelques minutes.',
  pack_status_unavailable: 'Impossible de relire vos crédits pour le moment. Réessayez dans quelques minutes.',
  reviews_unavailable: 'Les avis sont momentanément indisponibles.',
  sequence_unavailable: 'L’inscription aux e-mails est momentanément indisponible. Réessayez dans quelques minutes.',
  sequence_subscription_in_progress: 'Votre inscription est déjà en cours. Vérifiez votre boîte mail dans quelques minutes.',

  // Paiement : préparation (rien n'est prélevé)
  paypal_unavailable: PAYMENT_NOT_STARTED,
  paypal_not_configured: PAYMENT_NOT_STARTED,
  paypal_sdk_load_failed: 'Le module de paiement PayPal n’a pas pu se charger. Désactivez un éventuel bloqueur de publicités, puis rechargez la page.',
  paypal_create_order_failed: PAYMENT_NOT_STARTED,
  paypal_error: 'PayPal n’a pas pu finaliser le paiement. Vous pouvez réessayer.',
  invalid_product: 'Ce produit n’est pas disponible. Rechargez la page, puis réessayez.',
  offer_disabled: 'Cette offre n’est plus disponible pour le moment.',
  price_changed: 'Le montant a changé depuis l’ouverture de la page. Rechargez la page pour voir le montant à jour.',
  payment_required: 'Un paiement est nécessaire pour continuer.',
  payment_not_completed: 'Le paiement n’a pas encore été finalisé sur PayPal. Vous pouvez relancer le paiement.',

  // Paiement : confirmation (un montant a pu être prélevé)
  capture_failed: PAYMENT_NOT_CONFIRMED,
  payment_product_mismatch: PAYMENT_NOT_CONFIRMED,
  max_payment_token_missing: PAYMENT_NOT_CONFIRMED,
  access_provision_failed: PAYMENT_NOT_CONFIRMED,
  unknown_order: PAYMENT_NOT_CONFIRMED,
  invalid_order_id: PAYMENT_NOT_CONFIRMED,

  // Saisie
  validation_failed: 'Certaines informations sont incomplètes ou invalides. Vérifiez le formulaire, puis réessayez.',
  invalid_email: 'Cette adresse e-mail ne semble pas valide.',
  consent_required: 'Cochez la case de consentement pour continuer.',
  submission_failed: 'L’envoi n’a pas abouti. Réessayez dans quelques instants.',

  // Cartes cadeaux, pass, parcours
  gift_code_invalid: 'Ce code cadeau n’est pas reconnu. Vérifiez sa saisie.',
  gift_code_expired: 'Ce code cadeau a expiré.',
  gift_chronosphere_redeemed: 'Ce code cadeau a déjà été utilisé.',
  gift_lookup_failed: 'Impossible de vérifier ce code cadeau pour le moment. Réessayez dans quelques minutes.',
  invalid_pass: 'Ce lien de pass n’est pas valide. Vérifiez le lien reçu par e-mail.',
  discovery_required: 'Cette étape demande d’avoir d’abord la Découverte.',
  already_complete: 'Votre parcours est déjà complet.',
  path_closed: 'Le parcours progressif n’est pas ouvert pour le moment.',
  path_unavailable: 'Le parcours progressif est momentanément indisponible. Réessayez dans quelques minutes.',
  not_found: 'Élément introuvable. Rechargez la page, puis réessayez.',
  forbidden: 'Cette action n’est pas autorisée avec ce compte.',
}

const NETWORK_PATTERNS = /failed to fetch|networkerror|network error|load failed|network request failed|internet connection/i
const TIMEOUT_PATTERNS = /aborterror|timeout|timed out|the operation was aborted/i
// Messages techniques anglais qu'un client ne doit pas lire.
const RATE_LIMIT_PATTERNS = /rate limit|too many requests/i
// Phrases anglaises (Supabase, PayPal…) : jamais montrées telles quelles.
const ENGLISH_PATTERNS = /\b(the|is|are|not|invalid|exceeded|failed|unable|must|should|please|already|found|required)\b/i
const TECHNICAL_PATTERNS = /^(error|typeerror|syntaxerror)\b|unexpected token|json|undefined|null|is not a function|http \d{3}|status code|erreur api/i

function readMessage(error) {
  if (!error) return ''
  if (typeof error === 'string') return error.trim()
  if (typeof error.message === 'string') return error.message.trim()
  if (typeof error.error === 'string') return error.error.trim()
  return ''
}

// Traduit une erreur (Error, chaîne ou corps JSON { error, message }) en phrase
// pour le client. `fallback` est la phrase propre à l'écran quand rien de plus
// précis n'est connu.
export function userErrorMessage(error, fallback = DEFAULT_MESSAGE) {
  const name = typeof error === 'object' && error ? String(error.name || '') : ''
  const raw = readMessage(error)
  if (!raw && !name) return fallback
  if (NETWORK_PATTERNS.test(raw)) return NETWORK_MESSAGE
  if (name === 'AbortError' || name === 'TimeoutError' || TIMEOUT_PATTERNS.test(raw)) return TIMEOUT_MESSAGE
  if (RATE_LIMIT_PATTERNS.test(raw)) return RATE_LIMIT
  const code = raw.toLowerCase()
  if (Object.prototype.hasOwnProperty.call(CODES, code)) return CODES[code]
  // Un code inconnu (sans espace) ou un message technique : phrase de l'écran.
  if (!/\s/.test(raw) || TECHNICAL_PATTERNS.test(raw) || ENGLISH_PATTERNS.test(raw)) return fallback
  return raw
}

// Pour une réponse HTTP en échec : le statut compte quand le corps ne dit rien d'utile.
export function httpErrorMessage(status, body, fallback) {
  const fromBody = userErrorMessage(body?.message || body?.error || '', '')
  if (fromBody) return fromBody
  if (status === 401) return SESSION
  if (status === 429) return RATE_LIMIT
  if (status >= 500) return UNAVAILABLE
  return fallback || DEFAULT_MESSAGE
}
