/**
 * Préparation de l'import futur de l'export clients Reservio vers le
 * référentiel mediumia_customers. AUCUN import ici : fonctions pures, sans base
 * ni fichier (l'import réel passera par upsert_mediumia_customer et
 * record_mediumia_customer_consent, après validation).
 *
 * Colonnes Reservio :
 * firstname, lastname, email, phone          → gardées (gestion des rendez-vous)
 * address, note, birthday                    → écartées (peu remplies, pas nécessaires)
 * privacyPolicyAcceptedAt                    → consentement « privacy_policy » (≠ marketing)
 * marketingNotificationsAcceptedAt           → trace de l'ancien consentement « marketing »
 * Aucun consentement n'est utilisé pour envoyer quoi que ce soit en phase 1.
 */
import { normalizePhone } from './lumiaRdvIntake.js'

export const RESERVIO_KEPT_COLUMNS = ['firstname', 'lastname', 'email', 'phone']
export const RESERVIO_DROPPED_COLUMNS = ['address', 'note', 'birthday']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Même clé que la fonction SQL mediumia_name_key (aide à la vérification seulement).
export function nameKey(value) {
  const key = String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[Œœ]/g, 'o').replace(/[Ææ]/g, 'a').toLowerCase().replace(/[^a-z]/g, '')
  return key || null
}

export function namesCompatible(a, b) {
  const same = (x, y) => !nameKey(x) || !nameKey(y) || nameKey(x) === nameKey(y)
  return same(a.first_name, b.first_name) && same(a.last_name, b.last_name)
}

const text = (value, max = 80) => {
  const t = String(value ?? '').trim()
  return t ? t.slice(0, max) : null
}

function date(value) {
  if (value == null || String(value).trim() === '') return { value: null }
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? { value: d.toISOString() } : { value: null, invalid: true }
}

export function mapReservioCustomer(row = {}) {
  const issues = []
  const rawEmail = text(row.email, 254)?.toLowerCase() || null
  const email = rawEmail && EMAIL_RE.test(rawEmail) ? rawEmail : null
  if (rawEmail && !email) issues.push('email_invalid')
  const rawPhone = text(row.phone, 40)
  const phone = rawPhone ? normalizePhone(rawPhone) : null
  if (rawPhone && !phone) issues.push('phone_invalid')

  const consents = []
  for (const [column, kind] of [['privacyPolicyAcceptedAt', 'privacy_policy'], ['marketingNotificationsAcceptedAt', 'marketing']]) {
    const parsed = date(row[column])
    if (parsed.invalid) issues.push(`${kind}_date_invalid`)
    if (parsed.value) consents.push({ kind, source: 'reservio', accepted_at: parsed.value })
  }

  if (!email && !phone) {
    issues.push('no_contact')
    return { customer: null, consents: [], issues }
  }
  return {
    customer: {
      source: 'reservio',
      external_id: null, // l'export ne contient pas d'identifiant Reservio
      first_name: text(row.firstname),
      last_name: text(row.lastname),
      email,
      phone_e164: phone,
    },
    consents,
    issues,
  }
}

// Analyse « à blanc » d'un export : uniquement des compteurs, aucune donnée
// personnelle dans le résultat (utilisable pour valider avant tout import).
export function analyzeReservioExport(rows = []) {
  const report = {
    total: rows.length,
    importable: 0,
    without_contact: 0,
    invalid_phone: 0,
    invalid_email: 0,
    same_person_duplicates: 0,
    ambiguous_phones: 0,
    ambiguous_emails: 0,
    privacy_policy_consents: 0,
    marketing_consents: 0,
    dropped_columns_filled: Object.fromEntries(RESERVIO_DROPPED_COLUMNS.map((c) => [c, 0])),
  }
  const byPhone = new Map()
  const byEmail = new Map()
  for (const row of rows) {
    for (const column of RESERVIO_DROPPED_COLUMNS) if (text(row[column], 10_000)) report.dropped_columns_filled[column] += 1
    const { customer, consents, issues } = mapReservioCustomer(row)
    if (issues.includes('phone_invalid')) report.invalid_phone += 1
    if (issues.includes('email_invalid')) report.invalid_email += 1
    if (!customer) { report.without_contact += 1; continue }
    report.importable += 1
    for (const c of consents) report[c.kind === 'marketing' ? 'marketing_consents' : 'privacy_policy_consents'] += 1
    if (customer.phone_e164) byPhone.set(customer.phone_e164, [...(byPhone.get(customer.phone_e164) || []), customer])
    if (customer.email) byEmail.set(customer.email, [...(byEmail.get(customer.email) || []), customer])
  }
  const tally = (groups, key) => {
    for (const list of groups.values()) {
      if (list.length < 2) continue
      const compatible = list.every((c) => namesCompatible(c, list[0]))
      if (compatible) { if (key === 'phone') report.same_person_duplicates += list.length - 1 }
      else report[key === 'phone' ? 'ambiguous_phones' : 'ambiguous_emails'] += 1
    }
  }
  tally(byPhone, 'phone')
  tally(byEmail, 'email')
  return report
}
