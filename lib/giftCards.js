/* global process */
/**
 * Cartes cadeaux MediumIA — api/rdv-config.js?giftCardAction=<action>
 *
 *   GET  catalog   offres disponibles (montants, consultations, ChronoSphère, coffrets)
 *   POST create    commande PayPal (carte bancaire ou PayPal) pour une carte
 *   POST capture   encaisse, active la carte, envoie l'e-mail à l'acheteur
 *   GET  view      carte à imprimer (jeton secret reçu par e-mail)
 *   POST check     solde d'une carte pour une consultation (limité en nombre d'essais)
 *   POST chronosphere  active la partie ChronoSphère d'une carte (pack ou MAX)
 *
 * Le prix est toujours calculé côté serveur. La recherche d'un code se fait sur son
 * empreinte (code_hash) ; le code en clair, nécessaire pour envoyer la carte (y compris
 * à une date choisie), est rangé à part dans gift_card_delivery_secrets (serveur seul).
 * En production, la vente reste fermée tant que PAYPAL_GIFT_CARDS_ENABLED !== 'true'.
 * Aucune donnée personnelle n'est écrite dans les logs.
 */
import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { escapeHtml, sendEmail } from './transactionalEmail.js'
import { generateChronospherePaymentToken, getChronosphereProductDefinition } from './chronospherePayPal.js'
import { packExpiresAt } from './chronospherePackValidity.js'
import { buildChronosphereResumeUrl } from './chronosphereResume.js'

export const GIFT_PRACTITIONER_SLUG = 'sebastien-seguin'
export const GIFT_AMOUNTS_CENTS = [3000, 5000, 8000, 10000, 15000]
export const CHRONOSPHERE_GIFTS = {
  pack3: { cents: 990, label: 'ChronoSphère — pack de 3 tirages' },
  max3: { cents: 1990, label: 'ChronoSphère MAX — suivi en 3 lectures' },
}
export const GIFT_VALIDITY_MONTHS = 12
export const GIFT_TERMS_VERSION = 'gift-cards-2026-09-24-v1'
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SITE = 'https://mediumia.fr'

const PAYPAL = {
  sandbox: { base: 'https://api-m.sandbox.paypal.com' },
  live: { base: 'https://api-m.paypal.com' },
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const euros = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} €`

export function normalizeGiftCode(value) {
  return String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
}

export function generateGiftCode() {
  let raw = ''
  for (let i = 0; i < 8; i += 1) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return `MDIA-${raw.slice(0, 4)}-${raw.slice(4)}`
}

export function hashGiftCode(code) {
  return sha256(`gift:${normalizeGiftCode(code)}`)
}

export function addMonths(date, months) {
  const d = new Date(date)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

// Server-side price and content of a requested card. Returns null if invalid.
export function resolveGiftOffer(request, services) {
  const kind = request?.kind
  const serviceMap = new Map((services || []).map(s => [s.id, s]))
  if (kind === 'amount') {
    const cents = Number(request.amountCents)
    if (!GIFT_AMOUNTS_CENTS.includes(cents)) return null
    return { kind, label: `Carte cadeau ${euros(cents)}`, priceCents: cents, consultationCreditCents: cents, serviceId: null, chronosphereProduct: null }
  }
  if (kind === 'consultation' || kind === 'coffret') {
    const service = serviceMap.get(request.serviceId)
    if (!service || !Number.isInteger(service.price_cents) || service.price_cents <= 0) return null
    if (kind === 'consultation') {
      return { kind, label: `Séance « ${service.title} »`, priceCents: service.price_cents, consultationCreditCents: service.price_cents, serviceId: service.id, chronosphereProduct: null }
    }
    return {
      kind,
      label: `Coffret « ${service.title} » + ChronoSphère`,
      priceCents: service.price_cents + CHRONOSPHERE_GIFTS.pack3.cents,
      consultationCreditCents: service.price_cents,
      serviceId: service.id,
      chronosphereProduct: 'pack3',
    }
  }
  if (kind === 'chronosphere') {
    const product = CHRONOSPHERE_GIFTS[request.chronosphereProduct]
    if (!product) return null
    return { kind, label: product.label, priceCents: product.cents, consultationCreditCents: 0, serviceId: null, chronosphereProduct: request.chronosphereProduct }
  }
  return null
}

// Buyer / recipient details, validated and trimmed.
export function validateGiftPeople(body, today = new Date()) {
  const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
  const buyerName = clean(body?.buyerName, 80)
  const buyerEmail = clean(body?.buyerEmail, 254).toLowerCase()
  const recipientName = clean(body?.recipientName, 80)
  const recipientEmail = clean(body?.recipientEmail, 254).toLowerCase() || null
  const message = String(body?.message ?? '').trim().slice(0, 400) || null
  const sendOn = body?.sendOn ? String(body.sendOn) : null
  if (!buyerName) return { field: 'buyerName' }
  if (!EMAIL_RE.test(buyerEmail)) return { field: 'buyerEmail' }
  if (!recipientName) return { field: 'recipientName' }
  if (recipientEmail && !EMAIL_RE.test(recipientEmail)) return { field: 'recipientEmail' }
  if (sendOn) {
    if (!recipientEmail || !/^\d{4}-\d{2}-\d{2}$/.test(sendOn)) return { field: 'sendOn' }
    const todayStr = today.toISOString().slice(0, 10)
    const max = addMonths(today, 6).toISOString().slice(0, 10)
    if (sendOn < todayStr || sendOn > max) return { field: 'sendOn' }
  }
  if (body?.termsAccepted !== true) return { field: 'termsAccepted' }
  return { people: { buyerName, buyerEmail, recipientName, recipientEmail, message, sendOn } }
}

function paypalEnv() {
  const isProduction = process.env.VERCEL_ENV === 'production'
  if (isProduction && process.env.PAYPAL_GIFT_CARDS_ENABLED !== 'true') return null
  return isProduction ? 'live' : 'sandbox'
}

// Sandbox charges 1,00 € whatever the card, like the other test checkouts.
function chargedCents(env, priceCents) {
  return env === 'live' ? priceCents : 100
}

async function getAccessToken(env) {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) throw new Error('paypal_not_configured')
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${PAYPAL[env].base}/v1/oauth2/token`, {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) throw new Error('paypal_auth_failed')
  return data.access_token
}

async function loadGiftServices(supabase) {
  const { data: practitioner } = await supabase.from('booking_practitioners').select('id').eq('slug', GIFT_PRACTITIONER_SLUG).maybeSingle()
  if (!practitioner) return { practitionerId: null, services: [] }
  const { data: services } = await supabase
    .from('booking_services')
    .select('id, title, price_cents, duration_min, vat_rate_bps')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .eq('booking_mode', 'instant')
    .order('price_cents', { ascending: true })
  return { practitionerId: practitioner.id, services: (services || []).filter(s => Number.isInteger(s.price_cents) && s.price_cents > 0) }
}

export function giftUsageText(card) {
  const parts = []
  if (card.consultation_credit_cents > 0) parts.push(`${euros(card.consultation_credit_cents)} à utiliser pour une consultation : choisissez votre rendez-vous sur ${SITE}/rdv/${GIFT_PRACTITIONER_SLUG} et saisissez le code au moment du paiement.`)
  if (card.chronosphere_product === 'max3') parts.push(`${CHRONOSPHERE_GIFTS.max3.label} : connectez-vous (ou créez votre compte) sur ${SITE}/chronosphere-max et saisissez le code.`)
  else if (card.chronosphere_product) parts.push(`${CHRONOSPHERE_GIFTS[card.chronosphere_product].label} : saisissez le code sur ${SITE}/chronosphere.`)
  return parts
}

export function buildGiftEmail({ card, code, viewUrl, forRecipient }) {
  const expires = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(card.expires_at))
  const usage = giftUsageText(card)
  const subject = forRecipient ? `${card.buyer_name} vous offre une carte cadeau MediumIA` : 'Votre carte cadeau MediumIA'
  const intro = forRecipient
    ? `${card.recipient_name}, ${card.buyer_name} vous offre une carte cadeau MediumIA : ${card.label}.`
    : `Merci ${card.buyer_name} ! Votre carte cadeau « ${card.label} » pour ${card.recipient_name} est prête.`
  const delivery = !forRecipient && card.recipient_email
    ? (card.send_on ? `Elle sera envoyée par e-mail à ${card.recipient_email} le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(new Date(`${card.send_on}T12:00:00Z`))} au matin.` : `Elle vient d’être envoyée par e-mail à ${card.recipient_email}.`)
    : (!forRecipient ? 'Vous pouvez l’imprimer ou la transférer à la personne de votre choix.' : '')
  const text = [
    intro,
    card.message && forRecipient ? `\nSon message : « ${card.message} »\n` : '',
    `Code : ${code}`,
    `Valable jusqu’au ${expires}.`,
    ...usage,
    delivery,
    `Carte à imprimer : ${viewUrl}`,
    '\nÀ très bientôt,\nSébastien · MediumIA',
  ].filter(Boolean).join('\n')
  const html = `<!doctype html><html><body style="margin:0;background:#f5f0e6;font-family:Georgia,serif"><table width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:32px 16px"><table width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#fffdf8">
<tr><td style="background:#1a1535;padding:30px 32px;color:#fffaf0"><p style="margin:0;color:#e4c77a;font-size:12px;letter-spacing:2px">MEDIUMIA · CARTE CADEAU</p><h1 style="margin:12px 0 0;font-size:26px;font-weight:normal">${escapeHtml(card.label)}</h1></td></tr>
<tr><td style="padding:30px 32px;color:#4a4356;font-size:16px;line-height:1.65">
<p>${escapeHtml(intro)}</p>
${card.message && forRecipient ? `<p style="font-style:italic;color:#1a1535">« ${escapeHtml(card.message)} »</p>` : ''}
<p style="text-align:center;margin:26px 0;font-size:24px;letter-spacing:3px;color:#1a1535"><strong>${escapeHtml(code)}</strong></p>
<p style="text-align:center;font-size:13px;color:#706a80">Valable jusqu’au ${escapeHtml(expires)}</p>
${usage.map(line => `<p>${escapeHtml(line)}</p>`).join('')}
${delivery ? `<p>${escapeHtml(delivery)}</p>` : ''}
<p style="text-align:center;margin:28px 0"><a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:#1a1535;color:#e4c77a;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:bold">Voir et imprimer la carte</a></p>
<p>À très bientôt,<br><strong>Sébastien · MediumIA</strong></p>
</td></tr></table></td></tr></table></body></html>`
  return { subject, html, text }
}

function publicCard(card) {
  return {
    label: card.label,
    kind: card.kind,
    recipientName: card.recipient_name,
    buyerName: card.buyer_name,
    message: card.message,
    consultationCreditCents: card.consultation_credit_cents,
    balanceCents: card.balance_cents,
    chronosphereProduct: card.chronosphere_product,
    chronosphereRedeemed: Boolean(card.chronosphere_redeemed_at),
    expiresAt: card.expires_at,
    status: card.status,
    usage: giftUsageText(card),
  }
}

async function sendRecipientIfDue(supabase, card, code, viewUrl, now = new Date()) {
  if (!card.recipient_email || card.recipient_sent_at) return false
  if (card.send_on && card.send_on > now.toISOString().slice(0, 10)) return false
  const { data: claimed } = await supabase.from('gift_cards')
    .update({ recipient_sent_at: now.toISOString() })
    .eq('id', card.id).is('recipient_sent_at', null)
    .select('id').maybeSingle()
  if (!claimed) return false
  const message = buildGiftEmail({ card, code, viewUrl, forRecipient: true })
  await sendEmail({ to: card.recipient_email, ...message, idempotencyKey: `gift-card-recipient/${card.id}` })
  return true
}

// Daily job: e-mails the cards whose chosen delivery date has come.
export async function sendDueGiftCards(supabase, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const { data: cards, error } = await supabase.from('gift_cards')
    .select('*')
    .eq('status', 'active')
    .not('recipient_email', 'is', null)
    .is('recipient_sent_at', null)
    .lte('send_on', today)
    .limit(100)
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) return { skipped: 'migration_pending', sent: 0 }
  if (error) throw new Error('gift_card_due_lookup_failed')
  let sent = 0
  for (const card of cards || []) {
    const { data: secret } = await supabase.from('gift_card_delivery_secrets').select('code, view_token').eq('gift_card_id', card.id).maybeSingle()
    if (!secret) continue
    if (await sendRecipientIfDue(supabase, card, secret.code, `${SITE}/carte-cadeau/${secret.view_token}`, now)) sent += 1
  }
  return { sent }
}

export async function handleGiftCards(req, res, action) {
  res.setHeader('Cache-Control', 'no-store')
  if (!isSupabaseConfigured()) return res.status(503).json({ error: 'gift_cards_unavailable' })
  const supabase = getSupabaseAdmin()

  if (action === 'catalog') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    const env = paypalEnv()
    const { services } = await loadGiftServices(supabase)
    return res.status(200).json({
      open: Boolean(env && String(process.env.PAYPAL_CLIENT_ID || '').trim()),
      clientId: env ? String(process.env.PAYPAL_CLIENT_ID || '').trim() || null : null,
      env,
      validityMonths: GIFT_VALIDITY_MONTHS,
      termsVersion: GIFT_TERMS_VERSION,
      amounts: GIFT_AMOUNTS_CENTS,
      chronosphere: Object.entries(CHRONOSPHERE_GIFTS).map(([id, p]) => ({ id, label: p.label, cents: p.cents })),
      services: services.map(s => ({ id: s.id, title: s.title, priceCents: s.price_cents, durationMin: s.duration_min })),
      coffretExtraCents: CHRONOSPHERE_GIFTS.pack3.cents,
    })
  }

  if (action === 'create') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const env = paypalEnv()
    if (!env) return res.status(503).json({ error: 'gift_cards_closed' })
    const { people, field } = validateGiftPeople(req.body || {})
    if (!people) return res.status(400).json({ error: 'validation_failed', field })
    const { practitionerId, services } = await loadGiftServices(supabase)
    const offer = resolveGiftOffer(req.body || {}, services)
    if (!offer || !practitionerId) return res.status(400).json({ error: 'invalid_offer' })
    try {
      const accessToken = await getAccessToken(env)
      const charged = chargedCents(env, offer.priceCents)
      const response = await fetch(`${PAYPAL[env].base}/v2/checkout/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': randomUUID() },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: 'MEDIUMIA_GIFT_CARD',
            description: `MediumIA — ${offer.label}`.slice(0, 127),
            custom_id: `MEDIUMIA:${GIFT_TERMS_VERSION}:GIFT`,
            amount: { currency_code: 'EUR', value: (charged / 100).toFixed(2) },
          }],
          payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } } },
        }),
      })
      const order = await response.json().catch(() => ({}))
      if (!response.ok || !order.id) throw new Error('paypal_create_order_failed')

      const code = generateGiftCode()
      const viewToken = randomBytes(24).toString('base64url')
      const { data: inserted, error } = await supabase.from('gift_cards').insert({
        code_hash: hashGiftCode(code),
        code_last4: normalizeGiftCode(code).slice(-4),
        view_token_hash: sha256(viewToken),
        kind: offer.kind,
        label: offer.label,
        price_cents: offer.priceCents,
        consultation_credit_cents: offer.consultationCreditCents,
        balance_cents: 0,
        service_id: offer.serviceId,
        chronosphere_product: offer.chronosphereProduct,
        buyer_name: people.buyerName,
        buyer_email: people.buyerEmail,
        recipient_name: people.recipientName,
        recipient_email: people.recipientEmail,
        message: people.message,
        send_on: people.sendOn,
        paypal_env: env,
        paypal_order_id: order.id,
        terms_version: GIFT_TERMS_VERSION,
      }).select('id').single()
      if (error) throw new Error('gift_card_insert_failed')
      // The plain code and view token are needed later to e-mail the card (buyer
      // now, recipient possibly on a chosen date). They live in a separate table
      // readable by the server only.
      const { error: secretError } = await supabase.from('gift_card_delivery_secrets').insert({ gift_card_id: inserted.id, code, view_token: viewToken })
      if (secretError) throw new Error('gift_card_insert_failed')
      return res.status(201).json({ id: order.id })
    } catch (error) {
      const code = error?.message || 'paypal_create_order_failed'
      console.error('[gift-cards] create failed:', code)
      return res.status(code === 'paypal_not_configured' ? 500 : 502).json({ error: code })
    }
  }

  if (action === 'capture') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : ''
    if (!/^[A-Za-z0-9_-]{5,80}$/.test(orderId)) return res.status(400).json({ error: 'invalid_order_id' })
    try {
      const { data: card, error } = await supabase.from('gift_cards').select('*').eq('paypal_order_id', orderId).maybeSingle()
      if (error || !card) throw new Error('gift_card_not_found')
      const env = card.paypal_env
      if (card.status === 'payment_pending') {
        const accessToken = await getAccessToken(env)
        const captureResponse = await fetch(`${PAYPAL[env].base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
          method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `gift-capture-${orderId}`.slice(0, 108) },
        })
        let data = await captureResponse.json().catch(() => ({}))
        if (!captureResponse.ok || data.status !== 'COMPLETED') {
          const fetched = await fetch(`${PAYPAL[env].base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
          data = await fetched.json().catch(() => ({}))
          if (!fetched.ok || data.status !== 'COMPLETED') throw new Error('paypal_capture_failed')
        }
        const unit = (data.purchase_units || []).find(u => u.reference_id === 'MEDIUMIA_GIFT_CARD')
        const capture = unit?.payments?.captures?.find(c => c.status === 'COMPLETED')
        const expected = (chargedCents(env, card.price_cents) / 100).toFixed(2)
        if (!capture?.id || capture.amount?.currency_code !== 'EUR' || capture.amount?.value !== expected) throw new Error('paypal_amount_mismatch')

        const paidAt = new Date(capture.create_time || Date.now())
        const { data: activated } = await supabase.from('gift_cards').update({
          status: 'active',
          paypal_capture_id: capture.id,
          paid_at: paidAt.toISOString(),
          expires_at: addMonths(paidAt, GIFT_VALIDITY_MONTHS).toISOString(),
          balance_cents: card.consultation_credit_cents,
        }).eq('id', card.id).eq('status', 'payment_pending').select('*').maybeSingle()

        if (activated) {
          await recordGiftSale(supabase, activated, capture.id)
          Object.assign(card, activated)
        } else {
          const { data: fresh } = await supabase.from('gift_cards').select('*').eq('id', card.id).maybeSingle()
          if (!fresh || fresh.paypal_capture_id !== capture.id) throw new Error('capture_update_failed')
          Object.assign(card, fresh)
        }
      }
      if (card.status === 'payment_pending') throw new Error('paypal_capture_failed')

      const { data: secret } = await supabase.from('gift_card_delivery_secrets').select('code, view_token').eq('gift_card_id', card.id).maybeSingle()
      if (secret && !card.buyer_sent_at) {
        const { data: claimed } = await supabase.from('gift_cards').update({ buyer_sent_at: new Date().toISOString() }).eq('id', card.id).is('buyer_sent_at', null).select('id').maybeSingle()
        const viewUrl = `${SITE}/carte-cadeau/${secret.view_token}`
        if (claimed) await sendEmail({ to: card.buyer_email, ...buildGiftEmail({ card, code: secret.code, viewUrl, forRecipient: false }), idempotencyKey: `gift-card-buyer/${card.id}` })
        await sendRecipientIfDue(supabase, card, secret.code, viewUrl)
      }
      return res.status(200).json({ status: 'COMPLETED', viewToken: secret?.view_token || null })
    } catch (error) {
      const code = error?.message || 'paypal_capture_failed'
      console.error('[gift-cards] capture failed:', code)
      return res.status(502).json({ error: code })
    }
  }

  if (action === 'check') return handleGiftCheck(req, res, supabase)
  if (action === 'chronosphere') return handleGiftChronosphere(req, res, supabase)

  if (action === 'view') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    const token = String(req.query?.token || '')
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return res.status(404).json({ error: 'not_found' })
    const { data: card } = await supabase.from('gift_cards').select('*').eq('view_token_hash', sha256(token)).maybeSingle()
    if (!card || card.status === 'payment_pending') return res.status(404).json({ error: 'not_found' })
    const { data: secret } = await supabase.from('gift_card_delivery_secrets').select('code').eq('gift_card_id', card.id).maybeSingle()
    return res.status(200).json({ card: { ...publicCard(card), code: secret?.code || null } })
  }

  return res.status(400).json({ error: 'unknown_action' })
}

// Accounting: the sale is revenue now (single-purpose voucher, 20 % VAT).
async function recordGiftSale(supabase, card, captureId) {
  const { data: practitioner } = await supabase.from('booking_practitioners').select('id').eq('slug', GIFT_PRACTITIONER_SLUG).maybeSingle()
  if (!practitioner) return
  const vatRateBps = 2000
  const gross = card.paypal_env === 'live' ? card.price_cents : 100
  const net = Math.round((gross * 10000) / (10000 + vatRateBps))
  await supabase.from('rdv_financial_entries').insert({
    practitioner_id: practitioner.id,
    booking_id: null,
    service_id: card.service_id,
    source: 'mediumia',
    entry_kind: 'gift_card_sale',
    direction: 'income',
    payment_method: 'paypal',
    occurred_at: card.paid_at,
    gross_cents: gross,
    net_cents: net,
    vat_cents: gross - net,
    vat_rate_bps: vatRateBps,
    vat_status: 'taxable',
    currency: 'EUR',
    customer_name: card.buyer_name,
    customer_email: card.buyer_email,
    external_payment_ref: `gift:${captureId}`,
    note: `Carte cadeau — ${card.label} (…${card.code_last4})`,
  })
}

// ── Utilisation d'une carte pour une consultation (étape 2) ─────────────────

// A card usable for consultations: active, not expired, with a balance.
export async function findUsableGiftCard(supabase, code, now = new Date()) {
  const normalized = normalizeGiftCode(code)
  if (normalized.length !== 12 || !normalized.startsWith('MDIA')) return { error: 'gift_code_invalid' }
  const { data: card, error } = await supabase.from('gift_cards').select('*').eq('code_hash', hashGiftCode(normalized)).maybeSingle()
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) return { error: 'gift_code_invalid' }
  if (error) return { error: 'gift_lookup_failed' }
  if (!card || card.status === 'payment_pending' || card.status === 'cancelled') return { error: 'gift_code_invalid' }
  if (new Date(card.expires_at) <= now) return { error: 'gift_code_expired' }
  if (card.consultation_credit_cents === 0) return { error: 'gift_code_chronosphere_only' }
  if (card.balance_cents <= 0) return { error: 'gift_code_used' }
  return { card }
}

// Optimistic concurrency: the balance only moves if nobody changed it meanwhile,
// so one card can never be spent twice by two simultaneous bookings.
export async function reserveGiftBalance(supabase, card, amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > card.balance_cents) return false
  const nextBalance = card.balance_cents - amountCents
  const { data } = await supabase.from('gift_cards')
    .update({ balance_cents: nextBalance, status: nextBalance === 0 && (!card.chronosphere_product || card.chronosphere_redeemed_at) ? 'used' : 'active' })
    .eq('id', card.id).eq('balance_cents', card.balance_cents).eq('status', 'active')
    .select('id').maybeSingle()
  return Boolean(data)
}

export async function restoreGiftBalance(supabase, cardId, amountCents) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: card } = await supabase.from('gift_cards').select('balance_cents, consultation_credit_cents').eq('id', cardId).maybeSingle()
    if (!card) return false
    const next = Math.min(card.consultation_credit_cents, card.balance_cents + amountCents)
    const { data } = await supabase.from('gift_cards').update({ balance_cents: next, status: 'active' })
      .eq('id', cardId).eq('balance_cents', card.balance_cents).select('id').maybeSingle()
    if (data) return true
  }
  console.error('[gift-cards] balance restore failed')
  return false
}

// The sale was already counted (with VAT) when the card was bought: the use is
// recorded with payment_method 'gift_card', vat 0, and excluded from revenue totals.
export async function recordGiftRedemption(supabase, { card, bookingId, practitionerId, serviceId, servicePriceCents, appliedCents, startsAt, customerName, customerEmail }) {
  await supabase.from('gift_card_redemptions').insert({ gift_card_id: card.id, booking_id: bookingId, amount_cents: appliedCents })
  await supabase.from('rdv_financial_entries').insert({
    practitioner_id: practitionerId,
    booking_id: bookingId,
    service_id: serviceId,
    source: 'mediumia',
    entry_kind: appliedCents >= servicePriceCents ? 'full_payment' : 'arrhes',
    direction: 'income',
    payment_method: 'gift_card',
    occurred_at: new Date().toISOString(),
    gross_cents: appliedCents,
    net_cents: appliedCents,
    vat_cents: 0,
    vat_rate_bps: 0,
    vat_status: 'outside_scope',
    currency: 'EUR',
    service_price_cents: servicePriceCents,
    appointment_starts_at: startsAt,
    customer_name: customerName,
    customer_email: customerEmail,
    external_payment_ref: `gift-use:${card.id}:${bookingId}`,
    note: `Carte cadeau …${card.code_last4} (déjà encaissée à la vente)`,
  })
}

// Same keyed IP fingerprint as the booking API: the raw IP is never stored.
async function giftRateLimited(req, supabase) {
  const secret = String(process.env.RDV_RATE_LIMIT_SECRET || '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) return true
  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim().toLowerCase() || 'unknown'
  const { data } = await supabase.rpc('consume_api_rate_limit', {
    p_ip_hash: createHmac('sha256', secret).update(`gift-check:${ip}`).digest('hex'),
    p_endpoint: 'gift_card_check',
    p_hourly_limit: 20,
    p_daily_limit: 60,
  })
  return data?.allowed === false
}

export async function handleGiftCheck(req, res, supabase) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (await giftRateLimited(req, supabase)) return res.status(429).json({ error: 'too_many_attempts' })
  const { card, error } = await findUsableGiftCard(supabase, req.body?.code)
  if (!card) return res.status(error === 'gift_lookup_failed' ? 500 : 404).json({ error })
  return res.status(200).json({ valid: true, label: card.label, balanceCents: card.balance_cents, expiresAt: card.expires_at })
}

// A booking paid with a gift card and cancelled in time gives the amount back to
// the card (runs once: the cancellation only succeeds on the confirmed → cancelled step).
export async function restoreGiftForCancelledBooking(supabase, booking) {
  const { data: uses, error } = await supabase.from('gift_card_redemptions').select('gift_card_id, amount_cents').eq('booking_id', booking.id)
  if (error || !uses?.length) return 0
  let restored = 0
  for (const use of uses) {
    if (await restoreGiftBalance(supabase, use.gift_card_id, use.amount_cents)) restored += use.amount_cents
  }
  if (restored > 0) {
    await supabase.from('rdv_financial_entries').insert({
      practitioner_id: booking.practitioner_id,
      booking_id: booking.id,
      source: 'mediumia',
      entry_kind: 'refund',
      direction: 'refund',
      payment_method: 'gift_card',
      occurred_at: new Date().toISOString(),
      gross_cents: restored,
      net_cents: restored,
      vat_cents: 0,
      vat_rate_bps: 0,
      vat_status: 'outside_scope',
      currency: 'EUR',
      external_payment_ref: `gift-restore:${booking.id}`,
      note: 'Annulation : montant recrédité sur la carte cadeau',
    })
  }
  return restored
}

// ── Utilisation de la partie ChronoSphère (étape 3) ────────────────────────
// Carte « ChronoSphère » (pack ou MAX) ou coffret (consultation + pack) : le code
// crée un pack de 3 tirages déjà réglé, comme un achat PayPal capturé. La carte
// ne peut activer qu'un seul pack (paypal_order_id « GIFT-<carte> », unique).

async function authenticatedUser(req, supabase) {
  const match = String(req.headers?.authorization || '').trim().match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const { data, error } = await supabase.auth.getUser(match[1])
  return error || !data?.user?.id ? null : data.user
}

export async function handleGiftChronosphere(req, res, supabase, now = new Date()) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const product = ['pack3', 'max3'].includes(req.body?.product) ? req.body.product : null
  if (!product) return res.status(400).json({ error: 'invalid_product' })
  if (req.body?.consentAccepted !== true) return res.status(400).json({ error: 'consent_required' })
  if (await giftRateLimited(req, supabase)) return res.status(429).json({ error: 'too_many_attempts' })
  const user = product === 'max3' ? await authenticatedUser(req, supabase) : null
  if (product === 'max3' && !user) return res.status(401).json({ error: 'auth_required' })

  const normalized = normalizeGiftCode(req.body?.code)
  if (normalized.length !== 12 || !normalized.startsWith('MDIA')) return res.status(404).json({ error: 'gift_code_invalid' })
  const { data: card, error } = await supabase.from('gift_cards').select('*').eq('code_hash', hashGiftCode(normalized)).maybeSingle()
  if (error && !(error.code === '42P01' || error.code === 'PGRST205')) return res.status(500).json({ error: 'gift_lookup_failed' })
  if (!card || !['active', 'used'].includes(card.status)) return res.status(404).json({ error: 'gift_code_invalid' })
  if (!card.chronosphere_product) return res.status(409).json({ error: 'gift_no_chronosphere' })
  if (card.chronosphere_redeemed_at) return res.status(409).json({ error: 'gift_chronosphere_redeemed' })
  if (new Date(card.expires_at) <= now) return res.status(409).json({ error: 'gift_code_expired' })
  if (card.chronosphere_product !== product) return res.status(409).json({ error: 'gift_wrong_product', product: card.chronosphere_product })
  const definition = getChronosphereProductDefinition(product, card.paypal_env)
  if (!definition) return res.status(500).json({ error: 'gift_lookup_failed' })

  // Claim first: two simultaneous activations cannot both create a pack.
  const redeemedAt = now.toISOString()
  const { data: claimed } = await supabase.from('gift_cards')
    .update({ chronosphere_redeemed_at: redeemedAt, status: card.balance_cents === 0 ? 'used' : 'active' })
    .eq('id', card.id).eq('status', 'active').eq('balance_cents', card.balance_cents).is('chronosphere_redeemed_at', null)
    .select('id').maybeSingle()
  if (!claimed) return res.status(409).json({ error: 'gift_chronosphere_redeemed' })

  const token = generateChronospherePaymentToken()
  const { error: packError } = await supabase.from('chronosphere_credit_packs').insert({
    pack_token_hash: token.hash,
    paypal_order_id: `GIFT-${card.id}`,
    paypal_capture_id: `GIFT-${card.id}`,
    paypal_env: card.paypal_env,
    amount_cents: Math.round(Number(definition.amount) * 100),
    currency: 'EUR',
    credits_total: definition.credits,
    credits_remaining: definition.credits,
    status: 'active',
    consent_version: definition.consentVersion,
    consent_accepted_at: redeemedAt,
    captured_at: redeemedAt,
    product_type: product,
    user_id: user?.id || null,
  })
  if (packError) {
    await supabase.from('gift_cards').update({ chronosphere_redeemed_at: null, status: 'active' })
      .eq('id', card.id).eq('chronosphere_redeemed_at', redeemedAt)
    console.error('[gift-cards] chronosphere pack insert failed')
    return res.status(502).json({ error: 'gift_activation_failed' })
  }
  await supabase.from('gift_card_redemptions').insert({ gift_card_id: card.id, booking_id: null, amount_cents: CHRONOSPHERE_GIFTS[product].cents })

  // Pack (without an account): the personal link is also sent by e-mail, so the
  // draws are not lost if this browser is closed before the first reading.
  const email = String(req.body?.email || '').trim().toLowerCase()
  const resumeUrl = product === 'pack3' ? buildChronosphereResumeUrl(token.token) : null
  if (resumeUrl && EMAIL_RE.test(email) && email.length <= 254) {
    const text = `Votre carte cadeau est activée : ${CHRONOSPHERE_GIFTS.pack3.label}.\n\nVos 3 tirages sont à utiliser dans les 6 mois. Votre lien personnel pour les retrouver à tout moment :\n${resumeUrl}\n\nÀ très bientôt,\nSébastien · MediumIA`
    const html = `<!doctype html><html><body style="margin:0;background:#f5f0e6;font-family:Georgia,serif"><table width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:32px 16px"><table width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#fffdf8">
<tr><td style="background:#1a1535;padding:30px 32px;color:#fffaf0"><p style="margin:0;color:#e4c77a;font-size:12px;letter-spacing:2px">MEDIUMIA · CARTE CADEAU</p><h1 style="margin:12px 0 0;font-size:24px;font-weight:normal">Vos 3 tirages ChronoSphère sont prêts</h1></td></tr>
<tr><td style="padding:30px 32px;color:#4a4356;font-size:16px;line-height:1.65">
<p>Votre carte cadeau est activée. Vos 3 tirages sont à utiliser dans les 6 mois.</p>
<p style="text-align:center;margin:28px 0"><a href="${escapeHtml(resumeUrl)}" style="display:inline-block;background:#1a1535;color:#e4c77a;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:bold">Retrouver mes tirages</a></p>
<p style="font-size:13px;color:#706a80">Ce lien est personnel : il donne accès à vos tirages restants.</p>
<p>À très bientôt,<br><strong>Sébastien · MediumIA</strong></p>
</td></tr></table></td></tr></table></body></html>`
    await sendEmail({ to: email, subject: 'Vos tirages ChronoSphère offerts', html, text, idempotencyKey: `gift-chronosphere/${card.id}` }).catch(() => null)
  }

  return res.status(200).json({
    status: 'ACTIVATED',
    product,
    packToken: token.token,
    creditsRemaining: definition.credits,
    creditsTotal: definition.credits,
    expiresAt: packExpiresAt({ captured_at: redeemedAt }),
  })
}
