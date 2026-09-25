/**
 * GET /api/rdv-config?practitioner=<slug>
 *
 * Configuration publique pour la page de réservation.
 * Retourne les données dont RdvPublic.jsx a besoin sans auth.
 */
import { isSupabaseConfigured, getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { handlePayPalSandbox, handlePayPalCheckout } from '../lib/paypalSandbox.js'
import { handleReseauApply } from '../lib/reseauApply.js'
import { handleChronospherePayPal } from '../lib/chronospherePayPal.js'
import { handleMediumiaAnalytics } from '../lib/mediumiaAnalytics.js'
import { handleRdvDepositApi } from '../lib/rdvDepositApiHandler.js'
import { handleRdvFullPaymentCreate } from '../lib/rdvFullPaymentApiHandler.js'
import { handleRdvBalanceApi } from '../lib/rdvBalanceApiHandler.js'
import { handleRdvBalanceDailyCron } from '../lib/rdvBalanceCronHandler.js'
import { handleCustomerReviews } from '../lib/customerReviews.js'
import { handleGiftCards } from '../lib/giftCards.js'
import { handleFormationPath } from '../lib/formationPath.js'
import { handleDefi } from '../lib/defiIntuitionServer.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/

const CONFIG_REQUIRED = (notice, practitioner = null, services = []) => ({
  mode: 'configuration_required',
  availableWeekdays: null,
  horizonDays: null,
  notice: notice || 'Réservations temporairement indisponibles — configuration en cours.',
  practitioner,
  services,
})

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const rdvBalanceAction = req.query?.rdvBalanceAction
  if (rdvBalanceAction === 'cron') {
    return handleRdvBalanceDailyCron(req, res)
  }
  if (rdvBalanceAction) {
    return handleRdvBalanceApi(req, res, rdvBalanceAction)
  }

  const rdvDepositAction = req.query?.rdvDepositAction
  if (rdvDepositAction === 'createFull') {
    return handleRdvFullPaymentCreate(req, res)
  }
  if (rdvDepositAction) {
    return handleRdvDepositApi(req, res, rdvDepositAction)
  }

  const analyticsAction = req.query?.analyticsAction
  if (analyticsAction) {
    return handleMediumiaAnalytics(req, res, analyticsAction)
  }

  if (req.query?.action === 'reseau-apply') {
    return handleReseauApply(req, res)
  }

  const formationPathAction = req.query?.formationPathAction
  if (formationPathAction) {
    return handleFormationPath(req, res, formationPathAction)
  }

  const defiAction = req.query?.defiAction
  if (defiAction) {
    return handleDefi(req, res, defiAction)
  }

  const giftCardAction = req.query?.giftCardAction
  if (giftCardAction) {
    return handleGiftCards(req, res, giftCardAction)
  }

  const reviewsAction = req.query?.reviewsAction
  if (reviewsAction) {
    return handleCustomerReviews(req, res, reviewsAction)
  }

  const chronospherePayPalAction = req.query?.chronospherePayPalAction
  if (chronospherePayPalAction) {
    return handleChronospherePayPal(req, res, chronospherePayPalAction)
  }

  const paypalSandboxAction = req.query?.paypalSandboxAction
  if (paypalSandboxAction) {
    return handlePayPalSandbox(req, res, paypalSandboxAction)
  }

  const paypalAction = req.query?.paypalAction
  if (paypalAction) {
    return handlePayPalCheckout(req, res, paypalAction)
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const slug = req.query.practitioner
  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Paramètre practitioner manquant ou invalide' })
  }

  if (!isSupabaseConfigured()) {
    return res.status(200).json(CONFIG_REQUIRED('Réservations temporairement indisponibles — configuration en cours.'))
  }

  const supabase = getSupabaseAdmin()

  const { data: practitioner } = await supabase
    .from('booking_practitioners')
    .select('id, name, role, photo_url, tagline, booking_horizon_days, is_active, booking_enabled')
    .eq('slug', slug)
    .single()

  if (!practitioner || !practitioner.is_active) {
    return res.status(200).json(CONFIG_REQUIRED('Réservations temporairement indisponibles — configuration en cours.'))
  }

  const practitionerPublic = {
    name: practitioner.name,
    role: practitioner.role,
    photo_url: practitioner.photo_url,
    tagline: practitioner.tagline,
  }

  const { data: services } = await supabase
    .from('booking_services')
    .select('id, slug, title, description, duration_min, price_cents, currency, modality, is_active, sort_order, booking_mode, reservation_payment_kind, reservation_payment_cents, vat_rate_bps')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .order('sort_order')

  const activeServices = services || []

  if (!practitioner.booking_enabled) {
    return res.status(200).json(CONFIG_REQUIRED(
      'Les réservations sont actuellement fermées.',
      practitionerPublic,
      activeServices,
    ))
  }

  const { data: conn } = await supabase
    .from('booking_calendar_connections')
    .select('id')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (!conn) {
    return res.status(200).json(CONFIG_REQUIRED(
      'Réservations temporairement indisponibles — configuration en cours.',
      practitionerPublic,
      activeServices,
    ))
  }

  if (!practitioner.booking_horizon_days) {
    return res.status(200).json(CONFIG_REQUIRED(
      'Réservations temporairement indisponibles — configuration en cours.',
      practitionerPublic,
      activeServices,
    ))
  }

  const { data: rules, error: rulesErr } = await supabase
    .from('booking_availability_rules')
    .select('day_of_week')
    .eq('practitioner_id', practitioner.id)

  if (rulesErr || !rules?.length) {
    return res.status(200).json(CONFIG_REQUIRED(
      'Réservations temporairement indisponibles — configuration en cours.',
      practitionerPublic,
      activeServices,
    ))
  }

  const availableWeekdays = [...new Set(rules.map(r => (r.day_of_week + 1) % 7))].sort()

  return res.status(200).json({
    mode: 'live',
    availableWeekdays,
    horizonDays: practitioner.booking_horizon_days,
    notice: null,
    practitioner: practitionerPublic,
    services: activeServices,
  })
}
