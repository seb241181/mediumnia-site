// Caisse : encaissements ChronoSphère du mois (tirage 5 €, pack 9,90 €,
// MAX 19,90 €), lus en direct dans les tables de paiement PayPal.
//
// - Paiements réels uniquement (paypal_env = 'live'), jamais le Sandbox.
// - Les packs activés par une carte cadeau (capture « GIFT-… ») ne sont pas
//   comptés : la carte a déjà été encaissée, avec sa TVA, lors de sa vente.
// - Montants TTC ; HT et TVA calculés à 20 % (service numérique vendu en France).
// - Aucune donnée personnelle ne sort d'ici : uniquement des totaux par jour
//   et par produit.

import { isPlatformAdmin } from './proWorkspace.js'

export const CHRONOSPHERE_VAT_RATE_BPS = 2000
const MAX_RANGE_MS = 370 * 24 * 60 * 60 * 1000
const PAGE_SIZE = 1000

export const PRODUCT_LABELS = {
  single: 'Tirage unique',
  pack3: 'Pack 3 tirages',
  max3: 'ChronoSphère MAX',
}

export function splitVat(grossCents, rateBps = CHRONOSPHERE_VAT_RATE_BPS) {
  const net = Math.round((grossCents * 10000) / (10000 + rateBps))
  return { net_cents: net, vat_cents: grossCents - net }
}

// Jour civil à Paris (un achat à 23 h 30 reste sur le bon jour).
const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })

export function isGiftActivation(captureId) {
  return String(captureId || '').startsWith('GIFT-')
}

export function summarizeChronosphereIncome({ draws = [], packs = [] }) {
  const products = {
    single: { count: 0, gross_cents: 0 },
    pack3: { count: 0, gross_cents: 0 },
    max3: { count: 0, gross_cents: 0 },
  }
  const days = new Map()
  const dayProducts = new Map()
  let giftActivations = 0

  const add = (product, cents, capturedAt) => {
    products[product].count += 1
    products[product].gross_cents += cents
    const day = String(capturedAt || '').slice(0, 10)
    if (day) days.set(day, (days.get(day) || 0) + cents)
    const time = new Date(capturedAt)
    if (Number.isFinite(time.getTime())) {
      const key = `${parisDay.format(time)}|${product}`
      const line = dayProducts.get(key) || { count: 0, gross_cents: 0 }
      line.count += 1
      line.gross_cents += cents
      dayProducts.set(key, line)
    }
  }

  for (const draw of draws) {
    if (!draw?.paypal_capture_id || !draw.captured_at) continue
    add('single', Number(draw.amount_cents || 0), draw.captured_at)
  }
  for (const pack of packs) {
    if (!pack?.paypal_capture_id || !pack.captured_at) continue
    if (isGiftActivation(pack.paypal_capture_id)) { giftActivations += 1; continue }
    const product = pack.product_type === 'max3' ? 'max3' : 'pack3'
    add(product, Number(pack.amount_cents || 0), pack.captured_at)
  }

  const gross = Object.values(products).reduce((sum, p) => sum + p.gross_cents, 0)
  const count = Object.values(products).reduce((sum, p) => sum + p.count, 0)
  return {
    gross_cents: gross,
    ...splitVat(gross),
    vat_rate_bps: CHRONOSPHERE_VAT_RATE_BPS,
    count,
    products,
    gift_activations_excluded: giftActivations,
    // Export tableur : une ligne par jour (Paris) et par offre, TVA par ligne.
    daily_products: [...dayProducts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, line]) => {
        const [date, product] = key.split('|')
        return { date, product, label: PRODUCT_LABELS[product], ...line, ...splitVat(line.gross_cents) }
      }),
    daily: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, cents]) => ({ date, gross_cents: cents })),
  }
}

async function readAll(query) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query().range(from, from + PAGE_SIZE - 1)
    if (error) return { error }
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) return { rows }
  }
}

// Retourne { status, body } comme les autres actions de rdv-admin.
export async function getChronosphereIncome({ supabase, userId, query = {} }) {
  const from = new Date(query.from || '')
  const to = new Date(query.to || '')
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    return { status: 400, body: { error: 'periode_invalide' } }
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) return { status: 400, body: { error: 'periode_trop_longue' } }

  // ChronoSphère est l'activité de la plateforme : réservé à son administrateur.
  const access = await isPlatformAdmin(supabase, userId)
  if (access.error) return { status: 500, body: { error: access.error } }
  if (!access.allowed) return { status: 403, body: { error: 'pilotage_forbidden' } }

  const [draws, packs] = await Promise.all([
    readAll(() => supabase
      .from('chronosphere_paid_draws')
      .select('paypal_capture_id, amount_cents, captured_at')
      .eq('paypal_env', 'live')
      .not('paypal_capture_id', 'is', null)
      .gte('captured_at', from.toISOString())
      .lt('captured_at', to.toISOString())
      .order('captured_at', { ascending: true })),
    readAll(() => supabase
      .from('chronosphere_credit_packs')
      .select('paypal_capture_id, amount_cents, captured_at, product_type')
      .eq('paypal_env', 'live')
      .not('paypal_capture_id', 'is', null)
      .gte('captured_at', from.toISOString())
      .lt('captured_at', to.toISOString())
      .order('captured_at', { ascending: true })),
  ])
  if (draws.error || packs.error) return { status: 500, body: { error: 'chronosphere_finance_error' } }

  return {
    status: 200,
    body: {
      period: { from: from.toISOString(), to: to.toISOString() },
      ...summarizeChronosphereIncome({ draws: draws.rows, packs: packs.rows }),
    },
  }
}
