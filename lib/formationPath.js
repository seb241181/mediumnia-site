/* global Buffer, process */
/**
 * Parcours MediumIA au mois — api/rdv-config.js?formationPathAction=<action>
 *
 *   GET  status          état du parcours de l'élève connecté (payé, modules, reste, abonnement)
 *   GET  offer           offre publique (29 € puis 48 €/mois, dernière 40 €, 597 € maximum) ; 404 si fermé
 *   POST subscribe       crée l'abonnement PayPal (48 € répétés puis échéance finale) → id pour les boutons
 *   POST activate        après accord PayPal : rattache et synchronise l'abonnement
 *   POST unlock-create   commande « Tout débloquer » / échéance finale (reste exact à payer)
 *   POST unlock-capture  encaisse, puis arrête l'abonnement en cours
 *   POST cancel          arrête le parcours (plus aucun prélèvement)
 *   POST webhook         notifications PayPal : relit l'abonnement chez PayPal (jamais le contenu reçu)
 *
 * Règles : lib/formationProgression.js. Toute somme est relue chez PayPal et
 * enregistrée une seule fois (paypal_ref unique) ; le total encaissé ne peut
 * jamais dépasser 597 € (prix de la Formation complète). Aucune donnée personnelle dans les logs.
 *
 * Deux notions distinctes :
 *   - environnement de paiement (pathEnv) : live en production, sandbox ailleurs,
 *     quel que soit l'interrupteur ;
 *   - ouverture commerciale (pathOpen) : PAYPAL_FORMATION_PATH_ENABLED === 'true' en
 *     production (toujours ouvert en préversion, pour les tests Sandbox).
 * Fermé : ni offre, ni nouvelle souscription, ni nouvelle entrée dans le parcours.
 * Mais un parcours déjà engagé (abonnement existant ou mensualité / déblocage déjà
 * payé) garde tout : état, arrêt, activation d'un abonnement déjà créé, « Tout
 * débloquer », encaissement d'une commande déjà créée, webhook, synchronisation
 * quotidienne, arrêt lors d'un achat complet, garde-fou des 597 €.
 */
import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { escapeHtml, sendEmail } from './transactionalEmail.js'
import { CAP_CENTS, DISCOVERY_CENTS, STEP_CENTS, TOTAL_MODULES, euros, exceedsCap, nextStepModules, scheduleFor, summarize } from './formationProgression.js'
import { discoveryCaptureStatus, isEligibleDiscoveryPurchase } from './discoveryEligibility.js'

export const PATH_TERMS_VERSION = 'formation-parcours-597-2026-09-26'
// New plan code for the 597 € model: the former 34 € plan is never reused.
const PLAN_CODE = 'parcours-48x-final-597'
// Standard path after the Découverte: 11 × 48 € then 40 €.
const STANDARD = scheduleFor(CAP_CENTS - DISCOVERY_CENTS)
const PAYPAL = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
}
const SITE = 'https://mediumia.fr'
const OWNER_EMAIL = 'contact@mediumia.fr'
const value2 = (cents) => (cents / 100).toFixed(2)
const frenchDate = (iso) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(iso))

// Payment environment: never decided by the switch.
export function pathEnv() {
  return process.env.VERCEL_ENV === 'production' ? 'live' : 'sandbox'
}

// Commercial opening: new entries into the parcours only.
export function pathOpen() {
  return process.env.VERCEL_ENV !== 'production' || process.env.PAYPAL_FORMATION_PATH_ENABLED === 'true'
}

// A parcours really under way: a subscription was created, or an instalment /
// « Tout débloquer » was paid. A Découverte alone is not an engaged parcours.
async function engagedInParcours(supabase, userId, env, payments) {
  if (payments.some((p) => p.kind === 'monthly' || p.kind === 'unlock')) return true
  const { data, error } = await supabase.from('mediumia_formation_subscriptions').select('paypal_subscription_id').eq('user_id', userId).eq('paypal_env', env).limit(1)
  if (error) throw new Error('subscription_lookup_failed')
  return Boolean(data?.length)
}

// ── PayPal ───────────────────────────────────────────────────────────────────

async function token(env) {
  const id = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  if (!id || !secret) throw new Error('paypal_not_configured')
  const res = await fetch(`${PAYPAL[env]}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) throw new Error('paypal_auth_failed')
  return data.access_token
}

async function paypal(env, access, method, path, body, requestId) {
  const res = await fetch(`${PAYPAL[env]}${path}`, {
    method,
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// One product + one plan per environment, created on first use and remembered.
// Plan: 11 × 48 € (TRIAL cycles) then 1 × 40 € (REGULAR); each subscription
// overrides the counts and the final amount for what that student has left.
export async function ensurePlan(supabase, env, access) {
  const { data: known } = await supabase.from('mediumia_paypal_plans').select('paypal_plan_id').eq('paypal_env', env).eq('code', PLAN_CODE).maybeSingle()
  if (known?.paypal_plan_id) return known.paypal_plan_id
  const product = await paypal(env, access, 'POST', '/v1/catalogs/products', {
    name: 'MediumIA — Parcours de formation', type: 'DIGITAL', category: 'EDUCATIONAL_AND_TEXTBOOKS',
  }, `mediumia-path-product-${env}`)
  if (!product.ok || !product.data.id) throw new Error('paypal_product_failed')
  const plan = await paypal(env, access, 'POST', '/v1/billing/plans', {
    product_id: product.data.id,
    name: 'MediumIA — Parcours au mois (597 € maximum)',
    status: 'ACTIVE',
    billing_cycles: [
      { frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'TRIAL', sequence: 1, total_cycles: STANDARD.regularCount, pricing_scheme: { fixed_price: { value: value2(STEP_CENTS), currency_code: 'EUR' } } },
      { frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 2, total_cycles: 1, pricing_scheme: { fixed_price: { value: value2(STANDARD.finalCents), currency_code: 'EUR' } } },
    ],
    payment_preferences: { auto_bill_outstanding: false, payment_failure_threshold: 2 },
  }, `mediumia-path-plan-${env}`)
  if (!plan.ok || !plan.data.id) throw new Error('paypal_plan_failed')
  await supabase.from('mediumia_paypal_plans').upsert({ paypal_env: env, code: PLAN_CODE, paypal_product_id: product.data.id, paypal_plan_id: plan.data.id }, { onConflict: 'paypal_env,code', ignoreDuplicates: true })
  const { data: stored } = await supabase.from('mediumia_paypal_plans').select('paypal_plan_id').eq('paypal_env', env).eq('code', PLAN_CODE).maybeSingle()
  return stored?.paypal_plan_id || plan.data.id
}

// ── Données ─────────────────────────────────────────────────────────────────

async function currentUser(req, supabase) {
  const match = String(req.headers?.authorization || '').trim().match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const { data, error } = await supabase.auth.getUser(match[1])
  return error || !data?.user?.id ? null : data.user
}

// The Découverte that opens the parcours meets the same criteria as the 568 €
// credit: purchase recorded by this server in the same environment (live in
// production, never a Sandbox one), provisioned, owned by this account; before
// any money moves (access token given), PayPal must confirm it is still paid.
// A Découverte refunded at PayPal is recorded as refunded and no longer counts.
async function eligiblePayments(supabase, env, userId, payments, access = null) {
  const discoveries = payments.filter((p) => p.kind === 'discovery')
  if (!discoveries.length) return payments
  const { data: purchases, error } = await supabase.from('mediumia_paypal_purchases')
    .select('paypal_capture_id, user_id, paypal_env, status, amount_cents, product_code')
    .in('paypal_capture_id', discoveries.map((d) => d.paypal_ref))
  if (error) throw new Error('discovery_check_unavailable')
  const refunded = new Set(payments.filter((p) => p.kind === 'refund' && p.refunded_kind === 'discovery').map((p) => String(p.paypal_ref).replace(/^refund:/, '')))
  const dropped = new Set()
  for (const d of discoveries) {
    const purchase = (purchases || []).find((x) => x.paypal_capture_id === d.paypal_ref)
    if (refunded.has(d.paypal_ref) || !isEligibleDiscoveryPurchase(purchase, { userId, env })) { dropped.add(d.paypal_ref); continue }
    if (!access) continue
    const state = await discoveryCaptureStatus(env, access, d.paypal_ref)
    if (state === 'paid') continue
    dropped.add(d.paypal_ref)
    if (state === 'refunded') {
      await supabase.from('mediumia_formation_payments').insert({
        user_id: userId, paypal_env: env, kind: 'refund', refunded_kind: 'discovery', amount_cents: d.amount_cents || d.value_cents,
        value_cents: d.value_cents, paypal_ref: `refund:${d.paypal_ref}`, paid_at: new Date().toISOString(),
      }).then(() => null, () => null)
    }
  }
  return payments.filter((p) => !(p.kind === 'discovery' && dropped.has(p.paypal_ref))
    && !(p.kind === 'refund' && p.refunded_kind === 'discovery' && dropped.has(String(p.paypal_ref).replace(/^refund:/, ''))))
}

// Ledger as the parcours counts it. With a token, the Découverte is confirmed
// with PayPal; if PayPal cannot answer, the base alone decides (never blocks a sync).
async function countedPayments(supabase, env, userId, access = null) {
  const rows = await loadPayments(supabase, userId, env)
  if (!access) return eligiblePayments(supabase, env, userId, rows)
  return eligiblePayments(supabase, env, userId, rows, access).catch(() => eligiblePayments(supabase, env, userId, rows))
}

async function loadPayments(supabase, userId, env) {
  const { data, error } = await supabase.from('mediumia_formation_payments')
    .select('kind, refunded_kind, value_cents, amount_cents, paid_at, paypal_ref')
    .eq('user_id', userId).eq('paypal_env', env)
  if (error) throw new Error('payments_read_failed')
  return data || []
}

// Students who already own the complete formation for good are complete:
// nothing is ever offered or charged to them. Same white list as the student
// space (api/_lib/access.js): former complete purchase, used conference pass,
// founder, complete annual historical code. The historical purchase taken over
// by hand (legacy-paypal:…) has no exception here: the founder status covers it.
// Temporary accesses (Sandbox tests, v2 codes, manual grants, unknown origins)
// never count here.
// Real payments only (PayPal live): a Sandbox test never makes anyone complete.
const PERMANENT_COMPLETE = [
  (r) => r.type === 'purchase' && /^paypal:live:[A-Za-z0-9_-]+$/.test(r.origin_ref || ''),
  (r) => r.type === 'purchase' && /^conference-pass:live:[A-Za-z0-9_-]+$/.test(r.origin_ref || ''),
  (r) => r.type === 'admin' && /^founder:[0-9a-f-]{36}$/i.test(r.origin_ref || ''),
  (r) => r.type === 'legacy_code' && r.access_level === 'full'
    && (new Date(r.access_expires_at) - new Date(r.access_started_at)) / 86_400_000 >= 365 - 1 / 24,
]
export function ownsCompleteFormation(rows = []) {
  return rows.some((r) => r.status !== 'revoked' && Number(r.max_module) === 25 && PERMANENT_COMPLETE.some((test) => test(r)))
}
async function hasCompleteAccess(supabase, userId) {
  const { data } = await supabase.from('mediumia_entitlements')
    .select('type, origin_ref, status, access_level, max_module, access_started_at, access_expires_at').eq('user_id', userId).eq('max_module', 25)
  return ownsCompleteFormation(data || [])
}

// The student space (another address) may read the status and stop the parcours.
const STUDENT_ORIGINS = new Set(['https://espace.mediumia.fr', 'https://app.mediumnia.fr', 'https://app.mediumia.fr'])
function allowStudentSpace(req, res, action) {
  const origin = String(req.headers?.origin || '')
  const configured = String(process.env.MEDIUMIA_STUDENT_APP_URL || '').replace(/\/+$/, '')
  if (!['status', 'cancel'].includes(action) || !(STUDENT_ORIGINS.has(origin) || (configured && origin === configured))) return false
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Max-Age', '600')
  return true
}

async function liveSubscription(supabase, userId, env) {
  const { data } = await supabase.from('mediumia_formation_subscriptions')
    .select('*').eq('user_id', userId).eq('paypal_env', env).in('status', ['approval_pending', 'active'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data || null
}

// Access follows the ledger: module maximum and coach window (12 months after
// the last payment). The Discovery keeps its own 30-day row.
async function applyEntitlement(supabase, userId, env, before, after) {
  if (!after.lastPaidAt || after.maxModule < 1) return
  const { error } = await supabase.rpc('mediumia_set_path_entitlement', {
    p_user_id: userId, p_env: env, p_max_module: after.maxModule, p_expires_at: after.coachUntil,
  })
  if (error) throw new Error('entitlement_update_failed')
  if (after.maxModule > (before?.maxModule || 0)) await notifyNewStep(supabase, userId, env, before, after)
}

async function notifyNewStep(supabase, userId, env, before, after) {
  if (env !== 'live') return
  const { data } = await supabase.auth.admin.getUserById(userId)
  const email = data?.user?.email
  if (!email) return
  const from = (before?.maxModule || 0) + 1
  const modules = from === after.maxModule ? `le module ${from}` : `les modules ${from} à ${after.maxModule}`
  const done = after.complete
  const subject = done ? 'Votre parcours MediumIA est entièrement ouvert ✦' : 'Votre nouvelle étape MediumIA est ouverte ✦'
  const intro = done
    ? `Votre parcours est complet : ${modules} vous attendent. Il n’y aura plus aucun prélèvement.`
    : `Votre paiement est confirmé : ${modules} vous attendent dans votre espace élève.`
  const app = String(process.env.MEDIUMIA_STUDENT_APP_URL || 'https://espace.mediumia.fr').replace(/\/+$/, '')
  await sendEmail({
    to: email,
    subject,
    text: `${intro}\n\nMon espace élève : ${app}\nMon parcours : ${SITE}/formation/parcours\n\nSébastien · MediumIA`,
    html: `<div style="font-family:Georgia,serif;color:#1A1535;max-width:600px"><h2 style="color:#C9A84C">${escapeHtml(subject)}</h2><p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(app)}" style="color:#1A1535;font-weight:700">Ouvrir mon espace élève →</a></p><p style="font-size:13px;color:#716b7c">Suivre ou arrêter mon parcours : <a href="${SITE}/formation/parcours">${SITE}/formation/parcours</a></p></div>`,
    idempotencyKey: `formation-path-step/${userId}/${after.maxModule}`,
  }).catch(() => null)
}

async function warnOwner(subject, text) {
  await sendEmail({ to: OWNER_EMAIL, subject: `[MediumIA] ${subject}`, text, html: `<p>${escapeHtml(text)}</p>` }).catch(() => null)
}

// ── Synchronisation d'un abonnement (webhook, retour PayPal, tâche du matin) ──

export async function syncSubscription(supabase, env, subscriptionId, access) {
  const { data: row } = await supabase.from('mediumia_formation_subscriptions').select('*').eq('paypal_subscription_id', subscriptionId).eq('paypal_env', env).maybeSingle()
  if (!row) return { status: 'unknown_subscription' }
  const sub = await paypal(env, access, 'GET', `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`)
  if (!sub.ok) throw new Error('paypal_subscription_read_failed')
  if (sub.data.custom_id && sub.data.custom_id !== row.user_id) throw new Error('subscription_owner_mismatch')

  const before = summarize(await countedPayments(supabase, env, row.user_id, access))
  const start = new Date(new Date(row.created_at).getTime() - 86_400_000).toISOString()
  const tx = await paypal(env, access, 'GET', `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/transactions?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(new Date().toISOString())}`)
  if (!tx.ok) throw new Error('paypal_transactions_read_failed')

  let overCap = false
  let running = before.paidCents
  const known = new Set((await loadPayments(supabase, row.user_id, env)).map((p) => p.paypal_ref))
  const transactions = (tx.data.transactions || []).slice().sort((a, b) => String(a.time).localeCompare(String(b.time)))
  for (const t of transactions) {
    const gross = Math.round(Number(t.amount_with_breakdown?.gross_amount?.value || 0) * 100)
    if (!t.id || gross <= 0 || t.amount_with_breakdown?.gross_amount?.currency_code !== 'EUR') continue
    if (['COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(t.status) && !known.has(t.id)) {
      if (running + gross > CAP_CENTS) overCap = true
      const { error } = await supabase.from('mediumia_formation_payments').insert({
        user_id: row.user_id, paypal_env: env, kind: 'monthly', amount_cents: gross, value_cents: gross,
        paypal_ref: t.id, paypal_subscription_id: subscriptionId, paid_at: t.time || new Date().toISOString(),
      })
      if (!error) running += gross
      known.add(t.id)
    }
    if (['REFUNDED', 'PARTIALLY_REFUNDED'].includes(t.status) && !known.has(`refund:${t.id}`)) {
      const refunded = t.status === 'REFUNDED' ? gross : Math.round(Number(t.amount_with_breakdown?.net_amount?.value || 0) * 100)
      if (refunded > 0) {
        await supabase.from('mediumia_formation_payments').insert({
          user_id: row.user_id, paypal_env: env, kind: 'refund', refunded_kind: 'monthly', amount_cents: refunded, value_cents: refunded,
          paypal_ref: `refund:${t.id}`, paypal_subscription_id: subscriptionId, paid_at: new Date().toISOString(),
        })
        known.add(`refund:${t.id}`)
      }
    }
  }

  const after = summarize(await countedPayments(supabase, env, row.user_id))
  const map = { APPROVAL_PENDING: 'approval_pending', APPROVED: 'approval_pending', ACTIVE: 'active', SUSPENDED: 'suspended', CANCELLED: 'cancelled', EXPIRED: 'completed' }
  let status = map[sub.data.status] || row.status

  // Guard: never a cent above 597 €. A live subscription stops as soon as the
  // cap is reached (it should end by itself; this is the safety net).
  if ((after.complete || overCap) && ['active', 'approval_pending'].includes(status)) {
    await paypal(env, access, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { reason: 'Parcours MediumIA complet (597 €)' })
    status = after.complete ? 'completed' : 'cancelled'
  }
  if (overCap || after.paidCents > CAP_CENTS) await warnOwner('Parcours : paiement au-delà de 597 €', `Un abonnement du parcours a encaissé au-delà du plafond de 597 € (abonnement ${subscriptionId}, total ${euros(after.paidCents)}). Vérifiez-le dans PayPal et remboursez l'excédent de ${euros(Math.max(0, after.paidCents - CAP_CENTS))}.`)

  await supabase.from('mediumia_formation_subscriptions').update({
    status, updated_at: new Date().toISOString(), last_synced_at: new Date().toISOString(),
    ...(status === 'cancelled' && !row.cancelled_at ? { cancelled_at: new Date().toISOString() } : {}),
  }).eq('paypal_subscription_id', subscriptionId)

  await applyEntitlement(supabase, row.user_id, env, before, after)
  return { status, paidCents: after.paidCents, maxModule: after.maxModule, overCap }
}

// Daily safety net for missed webhooks.
export async function syncLiveSubscriptions(supabase) {
  const env = pathEnv()
  const { data: rows, error } = await supabase.from('mediumia_formation_subscriptions').select('paypal_subscription_id').eq('paypal_env', env).in('status', ['approval_pending', 'active']).limit(200)
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) return { skipped: 'migration_pending' }
  if (error) throw new Error('subscription_lookup_failed')
  if (!rows?.length) return { synced: 0 }
  const access = await token(env)
  let synced = 0
  for (const r of rows) {
    try { await syncSubscription(supabase, env, r.paypal_subscription_id, access); synced += 1 } catch { /* next one */ }
  }
  return { synced }
}

// ── Actions HTTP ────────────────────────────────────────────────────────────

// Public offer (Formation page), identical for everyone: 29 € then 11 × 48 €, last 40 €.
export function publicOffer() {
  return { capCents: CAP_CENTS, discoveryCents: DISCOVERY_CENTS, stepCents: STEP_CENTS, regularCount: STANDARD.regularCount, finalCents: STANDARD.finalCents }
}

// A complete one-off purchase (597 € or 568 € with the Découverte) ends any
// parcours subscription: it is stopped at PayPal, synchronised (an instalment
// collected meanwhile is recorded) and closed. Any total above 597 € is reported.
export async function settlePathAfterFullPurchase(supabase, env, userId) {
  if (!userId) return { skipped: true }
  try {
    const { data: subs, error } = await supabase.from('mediumia_formation_subscriptions').select('paypal_subscription_id')
      .eq('user_id', userId).eq('paypal_env', env).in('status', ['approval_pending', 'active', 'suspended'])
    if (error) return { skipped: true }
    let access = null
    for (const sub of subs || []) {
      access ||= await token(env)
      await paypal(env, access, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(sub.paypal_subscription_id)}/cancel`, { reason: 'Formation complète achetée' })
      await syncSubscription(supabase, env, sub.paypal_subscription_id, access).catch(() => null)
      await supabase.from('mediumia_formation_subscriptions').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('paypal_subscription_id', sub.paypal_subscription_id)
    }
    const total = summarize(await countedPayments(supabase, env, userId))
    if (total.paidCents > CAP_CENTS) {
      await warnOwner('Parcours : trop-perçu après un achat complet', `Un élève (${userId}) a payé ${euros(total.paidCents)} au total pour la formation (parcours + achat complet), soit ${euros(total.paidCents - CAP_CENTS)} au-delà de 597 €. Remboursez l'excédent dans PayPal.`)
    }
    return { stopped: (subs || []).length, paidCents: total.paidCents }
  } catch (error) {
    await warnOwner('Parcours : vérification à faire après un achat complet', `Un achat complet (élève ${userId}) n'a pas pu arrêter automatiquement un parcours en cours (${error?.message || 'erreur'}). Vérifiez l'abonnement dans PayPal.`)
    return { failed: true }
  }
}

// The parcours starts with an eligible Découverte. A student already under way
// whose Découverte was refunded keeps going: its 29 € simply join what is left.
const inParcours = (summary) => summary.hasDiscovery || summary.hasFull || summary.monthlyCount > 0

function publicState(summary, sub) {
  const schedule = scheduleFor(summary.remainingCents)
  return {
    paidCents: summary.paidCents,
    capCents: CAP_CENTS,
    stepCents: STEP_CENTS,
    discoveryCents: DISCOVERY_CENTS,
    remainingCents: summary.remainingCents,
    maxModule: summary.maxModule,
    totalModules: TOTAL_MODULES,
    complete: summary.complete,
    hasDiscovery: summary.hasDiscovery,
    coachUntil: summary.coachUntil,
    nextModules: nextStepModules(summary),
    schedule,
    subscription: sub ? { status: sub.status, regularCount: sub.regular_count, finalCents: sub.final_cents } : null,
  }
}

export async function handleFormationPath(req, res, action, supabaseForTests = null) {
  res.setHeader('Cache-Control', 'no-store')
  const cors = allowStudentSpace(req, res, action)
  if (req.method === 'OPTIONS') return cors ? res.status(204).end() : res.status(403).json({ error: 'origin_not_allowed' })
  if (!supabaseForTests && !isSupabaseConfigured()) return res.status(503).json({ error: 'path_unavailable' })
  const env = pathEnv()
  const supabase = supabaseForTests || getSupabaseAdmin()

  if (action === 'webhook') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const resource = req.body?.resource || {}
    const subscriptionId = String(req.body?.event_type || '').startsWith('BILLING.SUBSCRIPTION.') ? resource.id : resource.billing_agreement_id
    if (!/^I-[A-Z0-9]{6,40}$/.test(String(subscriptionId || ''))) return res.status(200).json({ ok: true, ignored: 'not_a_subscription' })
    try {
      // The payload is never trusted: the subscription is read again from PayPal.
      const result = await syncSubscription(supabase, env, subscriptionId, await token(env))
      return res.status(200).json({ ok: true, status: result.status })
    } catch (error) {
      console.error('[formation-path] webhook sync failed:', error?.message || 'unknown')
      return res.status(500).json({ error: 'sync_failed' })
    }
  }

  const open = pathOpen()

  if (action === 'offer') {
    if (!open) return res.status(404).json({ error: 'not_found' })
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    return res.status(200).json({ enabled: true, ...publicOffer() })
  }

  const user = await currentUser(req, supabase)
  if (!user) return res.status(401).json({ error: 'auth_required' })
  // Closed: refused before anything else, not even a PayPal call.
  if (action === 'subscribe' && !open) return res.status(403).json({ error: 'path_closed' })

  try {
    // Closed: « Tout débloquer » only for a parcours already under way, refused
    // before any PayPal call (a Découverte alone never starts the parcours).
    if (!open && action === 'unlock-create' && !(await engagedInParcours(supabase, user.id, env, await loadPayments(supabase, user.id, env)))) {
      return res.status(403).json({ error: 'path_closed' })
    }
    // Money moments re-check the Découverte with PayPal; the status only reads the base.
    const moneyAction = ['subscribe', 'unlock-create'].includes(action)
    const access = moneyAction ? await token(env) : null
    const payments = await eligiblePayments(supabase, env, user.id, await loadPayments(supabase, user.id, env), access)
    if (await hasCompleteAccess(supabase, user.id)) payments.push({ kind: 'full', value_cents: CAP_CENTS, paid_at: null })
    const summary = summarize(payments)
    const sub = await liveSubscription(supabase, user.id, env)
    // Closed: only a parcours already under way keeps its page and its exits.
    const engaged = open || await engagedInParcours(supabase, user.id, env, payments)

    if (action === 'status') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
      if (!engaged) return res.status(404).json({ error: 'not_found' })
      return res.status(200).json({ env, open, clientId: String(process.env.PAYPAL_CLIENT_ID || '').trim() || null, termsVersion: PATH_TERMS_VERSION, ...publicState(summary, sub) })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

    if (action === 'subscribe') {
      // No new or resumed subscription while the parcours is closed.
      if (!open) return res.status(403).json({ error: 'path_closed' })
      if (req.body?.consent !== true) return res.status(400).json({ error: 'consent_required' })
      if (!inParcours(summary)) return res.status(409).json({ error: 'discovery_required' })
      if (summary.complete) return res.status(409).json({ error: 'already_complete' })
      if (sub?.status === 'active') return res.status(409).json({ error: 'already_subscribed' })
      const schedule = scheduleFor(summary.remainingCents)
      if (schedule.mode !== 'subscription') return res.status(409).json({ error: 'use_final_payment' })
      // An unfinished approval or a subscription suspended after failed payments
      // is closed at PayPal before a new one starts: never two that could bill.
      const { data: stale } = await supabase.from('mediumia_formation_subscriptions').select('paypal_subscription_id')
        .eq('user_id', user.id).eq('paypal_env', env).in('status', ['approval_pending', 'suspended'])
      for (const old of stale || []) {
        await paypal(env, access, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(old.paypal_subscription_id)}/cancel`, { reason: 'Nouvelle demande' })
        await supabase.from('mediumia_formation_subscriptions').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('paypal_subscription_id', old.paypal_subscription_id)
      }
      const planId = await ensurePlan(supabase, env, access)
      const created = await paypal(env, access, 'POST', '/v1/billing/subscriptions', {
        plan_id: planId,
        custom_id: user.id,
        plan: {
          billing_cycles: [
            { sequence: 1, total_cycles: schedule.regularCount, pricing_scheme: { fixed_price: { value: value2(STEP_CENTS), currency_code: 'EUR' } } },
            { sequence: 2, total_cycles: 1, pricing_scheme: { fixed_price: { value: value2(schedule.finalCents), currency_code: 'EUR' } } },
          ],
        },
        application_context: { brand_name: 'MediumIA', locale: 'fr-FR', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW' },
      }, randomUUID())
      if (!created.ok || !created.data.id) throw new Error('paypal_subscription_create_failed')
      const { error } = await supabase.from('mediumia_formation_subscriptions').insert({
        paypal_subscription_id: created.data.id, user_id: user.id, paypal_env: env, paypal_plan_id: planId,
        regular_count: schedule.regularCount, step_cents: STEP_CENTS, final_cents: schedule.finalCents,
        status: 'approval_pending', terms_version: PATH_TERMS_VERSION, terms_accepted_at: new Date().toISOString(),
      })
      if (error) throw new Error('subscription_store_failed')
      return res.status(201).json({ id: created.data.id, schedule })
    }

    if (action === 'activate') {
      const subscriptionId = String(req.body?.subscriptionId || '')
      const { data: row } = await supabase.from('mediumia_formation_subscriptions').select('user_id').eq('paypal_subscription_id', subscriptionId).maybeSingle()
      if (!row || row.user_id !== user.id) return res.status(404).json({ error: 'unknown_subscription' })
      const result = await syncSubscription(supabase, env, subscriptionId, await token(env))
      const fresh = summarize(await countedPayments(supabase, env, user.id))
      return res.status(200).json({ ...result, ...publicState(fresh, await liveSubscription(supabase, user.id, env)) })
    }

    if (action === 'unlock-create') {
      if (req.body?.consent !== true) return res.status(400).json({ error: 'consent_required' })
      if (!inParcours(summary)) return res.status(409).json({ error: 'discovery_required' })
      if (summary.complete || summary.remainingCents <= 0) return res.status(409).json({ error: 'already_complete' })
      const amount = summary.remainingCents
      const order = await paypal(env, access, 'POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: 'MEDIUMIA_PARCOURS_UNLOCK',
          custom_id: `${user.id}:${PATH_TERMS_VERSION}`.slice(0, 127),
          description: sub || summary.remainingCents < STEP_CENTS * 2 ? 'MediumIA — Parcours : étape finale' : 'MediumIA — Parcours : tout débloquer',
          amount: { currency_code: 'EUR', value: value2(amount) },
        }],
        payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', brand_name: 'MediumIA' } } },
      }, randomUUID())
      if (!order.ok || !order.data.id) throw new Error('paypal_order_failed')
      const { error } = await supabase.from('mediumia_formation_unlock_orders').insert({
        paypal_order_id: order.data.id, user_id: user.id, paypal_env: env, amount_cents: amount,
        terms_version: PATH_TERMS_VERSION, terms_accepted_at: new Date().toISOString(),
      })
      if (error) throw new Error('unlock_store_failed')
      return res.status(201).json({ id: order.data.id, amountCents: amount })
    }

    if (action === 'unlock-capture') {
      const orderId = String(req.body?.orderId || '')
      const { data: order } = await supabase.from('mediumia_formation_unlock_orders').select('*').eq('paypal_order_id', orderId).maybeSingle()
      if (!order || order.user_id !== user.id || order.paypal_env !== env) return res.status(404).json({ error: 'unknown_order' })
      if (order.status === 'captured') return res.status(200).json({ status: 'COMPLETED', ...publicState(summary, sub) })
      const access = await token(env)
      // Stop the running subscription first and record any instalment that has
      // just been collected, so that nothing can be charged in between.
      if (sub) {
        await paypal(env, access, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(sub.paypal_subscription_id)}/cancel`, { reason: 'Parcours débloqué en entier' })
        await syncSubscription(supabase, env, sub.paypal_subscription_id, access).catch(() => null)
        await supabase.from('mediumia_formation_subscriptions').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('paypal_subscription_id', sub.paypal_subscription_id)
      }
      // The Découverte is checked again with PayPal just before money moves: if it
      // was refunded meanwhile, the order no longer matches and nothing is charged.
      const currentPayments = await eligiblePayments(supabase, env, user.id, await loadPayments(supabase, user.id, env), access)
      const current = summarize(currentPayments)
      // Capture only if the order still brings the total exactly to 597 € at most.
      if (exceedsCap(current, order.amount_cents) || current.paidCents + order.amount_cents !== CAP_CENTS) {
        await supabase.from('mediumia_formation_unlock_orders').update({ status: 'refused' }).eq('paypal_order_id', orderId)
        return res.status(409).json({ error: 'amount_changed', ...publicState(current, null) })
      }
      const captured = await paypal(env, access, 'POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, null, `mediumia-path-capture-${orderId}`.slice(0, 108))
      let data = captured.data
      if (!captured.ok || data.status !== 'COMPLETED') {
        const fetched = await paypal(env, access, 'GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`)
        if (!fetched.ok || fetched.data.status !== 'COMPLETED') return res.status(402).json({ error: 'payment_not_completed' })
        data = fetched.data
      }
      const capture = (data.purchase_units || [])[0]?.payments?.captures?.find((c) => c.status === 'COMPLETED')
      const gross = Math.round(Number(capture?.amount?.value || 0) * 100)
      if (!capture?.id || capture.amount?.currency_code !== 'EUR' || gross !== order.amount_cents) throw new Error('paypal_amount_mismatch')
      await supabase.from('mediumia_formation_payments').insert({
        user_id: user.id, paypal_env: env, kind: 'unlock', amount_cents: gross, value_cents: gross,
        paypal_ref: capture.id, paid_at: capture.create_time || new Date().toISOString(),
      })
      await supabase.from('mediumia_formation_unlock_orders').update({ status: 'captured', captured_at: new Date().toISOString() }).eq('paypal_order_id', orderId)
      if (sub) await supabase.from('mediumia_formation_subscriptions').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('paypal_subscription_id', sub.paypal_subscription_id)
      const after = summarize(await countedPayments(supabase, env, user.id))
      await applyEntitlement(supabase, user.id, env, current, after)
      return res.status(200).json({ status: 'COMPLETED', ...publicState(after, null) })
    }

    if (action === 'cancel') {
      if (!sub) return res.status(409).json({ error: 'no_subscription' })
      const access = await token(env)
      const cancelled = await paypal(env, access, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(sub.paypal_subscription_id)}/cancel`, { reason: 'Arrêt demandé par l’élève' })
      if (!cancelled.ok && cancelled.status !== 422) throw new Error('paypal_cancel_failed')
      await supabase.from('mediumia_formation_subscriptions').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('paypal_subscription_id', sub.paypal_subscription_id)
      if (env === 'live' && user.email) {
        const coach = summary.coachUntil ? ` Votre coach MediumIA reste ouvert jusqu’au ${frenchDate(summary.coachUntil)} (12 mois après votre dernier paiement).` : ''
        const text = `Votre parcours MediumIA est arrêté : aucun nouveau prélèvement ne sera fait.\n\nVos modules débloqués (jusqu’au module ${summary.maxModule}), vos PDF et votre carnet restent à vous.${coach} Vous pouvez reprendre quand vous voulez : ${SITE}/formation/parcours\n\nSébastien · MediumIA`
        await sendEmail({ to: user.email, subject: 'Votre parcours MediumIA est arrêté', text, html: `<div style="font-family:Georgia,serif;color:#1A1535;max-width:600px">${text.split('\n\n').map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>`, idempotencyKey: `formation-path-cancel/${sub.paypal_subscription_id}` }).catch(() => null)
      }
      return res.status(200).json({ status: 'cancelled', ...publicState(summary, null) })
    }
  } catch (error) {
    console.error('[formation-path] failed:', error?.message || 'unknown')
    return res.status(502).json({ error: error?.message || 'path_failed' })
  }

  return res.status(400).json({ error: 'unknown_action' })
}

export const __formationPathTest = { euros }
