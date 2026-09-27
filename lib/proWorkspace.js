// Espace MediumIA Pro : invitations, activation de l'adhésion et assistant.
//
// Invitations, adhésions et création d'assistant passent par le serveur
// (service_role). Les droits RLS historiques permettent encore au propriétaire
// de modifier quelques champs de profil sûrs de son agent, mais jamais le
// fournisseur, le modèle, les consignes système, permissions ou rattachements.

import { reseauPractitioners } from '../src/data/reseauPractitioners.js'
import { sendEmail, escapeHtml } from './transactionalEmail.js'

export const PLATFORM_ADMIN_PRACTITIONER_SLUGS = ['sebastien-seguin']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const RESEAU_SLUGS = new Set(reseauPractitioners.map((p) => p.id))

export const ASSISTANT_FIELD_LIMITS = Object.freeze({
  name: 80,
  mission: 1500,
  audience: 1200,
  tone: 800,
  knowledge_summary: 6000,
  limits: 1500,
})

const AGENT_COLUMNS = 'id, name, status, mission, audience, tone, knowledge_summary, limits, reseau_slug, public_enabled, created_at, updated_at'

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function isKnownReseauSlug(slug) {
  return typeof slug === 'string' && RESEAU_SLUGS.has(slug)
}

function isMembershipLive(membership, now = new Date()) {
  if (!membership || membership.status !== 'active') return false
  return !membership.expires_at || new Date(membership.expires_at) > now
}

// Champs de l'assistant : texte nettoyé et borné. « limits » est ici le cadre
// que le praticien fixe à son assistant (ce qu'il ne doit pas faire), pas une
// limite technique d'exécution.
export function cleanAssistantFields(input) {
  const fields = {}
  const errors = []
  for (const [key, max] of Object.entries(ASSISTANT_FIELD_LIMITS)) {
    const raw = typeof input?.[key] === 'string' ? input[key] : ''
    const value = raw.replace(/\u0000/g, '').trim()
    if (value.length > max) errors.push(`${key}_too_long`)
    fields[key] = value.slice(0, max)
  }
  if (fields.name.length < 2) errors.push('name_required')
  if (fields.mission.length < 10) errors.push('mission_required')
  return { fields, errors }
}

async function loadUserEmail(db, userId) {
  const { data, error } = await db.auth.admin.getUserById(userId)
  if (error || !data?.user) return null
  return {
    email: normalizeEmail(data.user.email),
    confirmed: Boolean(data.user.email_confirmed_at || data.user.confirmed_at),
  }
}

async function loadMembership(db, userId) {
  const { data, error } = await db
    .from('pro_memberships')
    .select('id, access_level, status, expires_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error('membership_lookup_failed')
  return data || null
}

async function loadLiveAgent(db, userId, membershipId) {
  const { data, error } = await db
    .from('agents')
    .select(AGENT_COLUMNS)
    .eq('owner_id', userId)
    .eq('membership_id', membershipId)
    .neq('status', 'archived')
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw new Error('agent_lookup_failed')
  return data?.[0] || null
}

async function loadPendingInvitation(db, email) {
  if (!email) return null
  const { data, error } = await db
    .from('pro_invitations')
    .select('id, reseau_slug, created_at')
    .eq('email_normalized', email)
    .eq('status', 'pending')
    .maybeSingle()
  if (error) throw new Error('invitation_lookup_failed')
  return data || null
}

async function loadAcceptedInvitation(db, userId) {
  const { data } = await db
    .from('pro_invitations')
    .select('id, reseau_slug')
    .eq('accepted_user_id', userId)
    .eq('status', 'accepted')
    .order('accepted_at', { ascending: false })
    .limit(1)
  return data?.[0] || null
}

// ── Actions du professionnel (/agents) ─────────────────────────────────────

export async function getWorkspaceState({ db, userId }) {
  const membership = await loadMembership(db, userId)
  const live = isMembershipLive(membership)
  const agent = live ? await loadLiveAgent(db, userId, membership.id) : null
  let invitation = null
  let emailConfirmed = true
  if (!live) {
    const user = await loadUserEmail(db, userId)
    emailConfirmed = Boolean(user?.confirmed)
    invitation = await loadPendingInvitation(db, user?.email)
  }
  let reseauSlug = agent?.reseau_slug || null
  if (live && !agent) reseauSlug = (await loadAcceptedInvitation(db, userId))?.reseau_slug || null
  return {
    status: 200,
    body: {
      membership: membership ? {
        accessLevel: membership.access_level,
        status: membership.status,
        live,
      } : null,
      agent,
      invitation: invitation ? { reseauSlug: invitation.reseau_slug } : null,
      emailConfirmed,
      reseauSlug,
    },
  }
}

export async function claimInvitation({ db, userId }) {
  const existing = await loadMembership(db, userId)
  if (isMembershipLive(existing)) return { status: 200, body: { ok: true, alreadyActive: true } }
  // Un accès suspendu, expiré ou retiré ne se réactive jamais tout seul.
  if (existing && existing.status !== 'invited') return { status: 403, body: { error: 'membership_locked' } }

  const user = await loadUserEmail(db, userId)
  if (!user?.email) return { status: 403, body: { error: 'email_unknown' } }
  if (!user.confirmed) return { status: 403, body: { error: 'email_not_confirmed' } }

  const { data, error } = await db.rpc('claim_mediumia_pro_invitation', {
    p_user_id: userId,
    p_email_normalized: user.email,
  })
  if (error) return { status: 500, body: { error: 'invitation_claim_failed' } }

  const outcome = Array.isArray(data) ? data[0] : data
  if (outcome?.result === 'already_active') return { status: 200, body: { ok: true, alreadyActive: true } }
  if (outcome?.result === 'membership_locked') return { status: 403, body: { error: 'membership_locked' } }
  if (outcome?.result === 'invitation_not_found') return { status: 403, body: { error: 'invitation_not_found' } }
  if (outcome?.result !== 'activated') return { status: 500, body: { error: 'invitation_claim_failed' } }

  return { status: 200, body: { ok: true } }
}

export async function saveAssistant({ db, userId, input }) {
  const membership = await loadMembership(db, userId)
  if (!isMembershipLive(membership)) return { status: 403, body: { error: 'pro_access_required' } }

  const { fields, errors } = cleanAssistantFields(input)
  if (errors.length) return { status: 400, body: { error: 'invalid_assistant', details: errors } }

  const current = await loadLiveAgent(db, userId, membership.id)
  if (current) {
    const { data, error } = await db
      .from('agents')
      .update(fields)
      .eq('id', current.id)
      .eq('owner_id', userId)
      .select(AGENT_COLUMNS)
      .single()
    if (error) return { status: 500, body: { error: 'assistant_write_failed' } }
    return { status: 200, body: { agent: data, created: false } }
  }

  // La fiche Réseau vient de l'invitation acceptée, jamais du navigateur.
  const invitation = await loadAcceptedInvitation(db, userId)
  const reseauSlug = isKnownReseauSlug(invitation?.reseau_slug) ? invitation.reseau_slug : null

  const { data, error } = await db
    .from('agents')
    .insert({
      ...fields,
      owner_id: userId,
      membership_id: membership.id,
      status: 'active',
      provider: 'anthropic',
      reseau_slug: reseauSlug,
      public_enabled: false,
    })
    .select(AGENT_COLUMNS)
    .single()
  if (error) {
    if (error.code === '23505') return { status: 409, body: { error: 'reseau_profile_already_has_assistant' } }
    return { status: 500, body: { error: 'assistant_write_failed' } }
  }
  return { status: 201, body: { agent: data, created: true } }
}

// ── Administration (Pilotage) ──────────────────────────────────────────────

export async function isPlatformAdmin(db, userId) {
  const { data, error } = await db
    .from('booking_practitioners')
    .select('id')
    .eq('owner_id', userId)
    .in('slug', PLATFORM_ADMIN_PRACTITIONER_SLUGS)
    .limit(1)
  if (error) return { error: 'pilotage_access_error' }
  return { allowed: Boolean(data?.length) }
}

export function invitationEmail({ email, practitionerName, appUrl = 'https://mediumia.fr' }) {
  const who = practitionerName ? `Bonjour ${practitionerName.split(' ')[0]},` : 'Bonjour,'
  const link = `${appUrl}/agents`
  const text = [
    who,
    '',
    'Sébastien vous invite à créer votre assistant IA MediumIA, inclus dans votre adhésion au Réseau MediumIA.',
    '',
    'Votre assistant répond aux questions des personnes qui découvrent votre fiche : vos séances, votre approche, comment prendre rendez-vous. Vous décidez de ce qu’il sait et du moment où il devient visible.',
    '',
    `1. Ouvrez ${link}`,
    `2. Créez votre compte avec cette adresse : ${email}`,
    '3. Confirmez votre adresse grâce à l’e-mail reçu, puis revenez sur la page et activez votre espace.',
    '',
    'À très vite,',
    'Sébastien — MediumIA',
  ].join('\n')
  const html = `<div style="font-family:Georgia,serif;color:#1a1535;line-height:1.65;max-width:560px">
<p>${escapeHtml(who)}</p>
<p>Sébastien vous invite à créer votre <strong>assistant IA MediumIA</strong>, inclus dans votre adhésion au Réseau MediumIA.</p>
<p>Votre assistant répond aux questions des personnes qui découvrent votre fiche : vos séances, votre approche, comment prendre rendez-vous. Vous décidez de ce qu’il sait et du moment où il devient visible.</p>
<ol>
<li>Ouvrez <a href="${link}">${link}</a></li>
<li>Créez votre compte avec cette adresse : <strong>${escapeHtml(email)}</strong></li>
<li>Confirmez votre adresse grâce à l’e-mail reçu, puis revenez sur la page et activez votre espace.</li>
</ol>
<p style="margin:26px 0"><a href="${link}" style="background:#1a1535;color:#e2b857;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Créer mon assistant</a></p>
<p>À très vite,<br>Sébastien — MediumIA</p>
</div>`
  return { subject: 'Votre assistant IA MediumIA vous attend', text, html }
}

export async function listProMembers({ db }) {
  const { data: invitations, error } = await db
    .from('pro_invitations')
    .select('id, email, reseau_slug, status, created_at, accepted_at, accepted_user_id')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return { status: 500, body: { error: 'pro_members_lookup_failed' } }

  const userIds = [...new Set((invitations || []).map((i) => i.accepted_user_id).filter(Boolean))]
  let agentsByOwner = new Map()
  if (userIds.length) {
    const { data: agents } = await db
      .from('agents')
      .select('owner_id, name, status, public_enabled, reseau_slug')
      .in('owner_id', userIds)
      .neq('status', 'archived')
    agentsByOwner = new Map((agents || []).map((a) => [a.owner_id, a]))
  }

  return {
    status: 200,
    body: {
      members: (invitations || []).map((i) => {
        const agent = i.accepted_user_id ? agentsByOwner.get(i.accepted_user_id) : null
        return {
          id: i.id,
          email: i.email,
          reseauSlug: i.reseau_slug,
          status: i.status,
          createdAt: i.created_at,
          acceptedAt: i.accepted_at,
          assistant: agent ? { name: agent.name, status: agent.status, publicEnabled: agent.public_enabled } : null,
        }
      }),
      reseauProfiles: reseauPractitioners.map((p) => ({ id: p.id, name: p.name })),
    },
  }
}

export async function inviteProMember({ db, userId, input, send = sendEmail }) {
  const email = normalizeEmail(input?.email)
  if (!EMAIL_RE.test(email) || email.length > 254) return { status: 400, body: { error: 'invalid_email' } }
  const reseauSlug = input?.reseauSlug ? String(input.reseauSlug) : null
  if (reseauSlug && !isKnownReseauSlug(reseauSlug)) return { status: 400, body: { error: 'unknown_reseau_profile' } }

  const existing = await loadPendingInvitation(db, email)

  if (reseauSlug) {
    const { data: occupied, error: occupiedError } = await db
      .from('pro_invitations')
      .select('id, email_normalized, status')
      .eq('reseau_slug', reseauSlug)
      .in('status', ['pending', 'accepted'])
      .limit(1)
    if (occupiedError) return { status: 500, body: { error: 'invitation_lookup_failed' } }
    if (occupied?.length && occupied[0].id !== existing?.id) {
      return { status: 409, body: { error: 'reseau_profile_already_invited' } }
    }
  }

  const write = existing
    ? db.from('pro_invitations').update({ reseau_slug: reseauSlug, invited_by: userId }).eq('id', existing.id)
    : db.from('pro_invitations').insert({ email, reseau_slug: reseauSlug, invited_by: userId })
  const { error } = await write
  // Deux invitations simultanées pour la même fiche : l'index unique tranche.
  if (error?.code === '23505') return { status: 409, body: { error: 'reseau_profile_already_invited' } }
  if (error) return { status: 500, body: { error: 'invitation_write_failed' } }

  const practitioner = reseauPractitioners.find((p) => p.id === reseauSlug)
  const message = invitationEmail({ email, practitionerName: practitioner?.name })
  const delivery = await send({ to: email, ...message, idempotencyKey: `pro-invitation/${email}/${Date.now()}` })
    .catch(() => ({ status: 'error' }))

  return { status: existing ? 200 : 201, body: { ok: true, emailStatus: delivery?.status || 'unknown' } }
}

export async function revokeProInvitation({ db, input }) {
  const id = String(input?.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400, body: { error: 'invalid_invitation' } }
  const { data: invitation } = await db
    .from('pro_invitations')
    .select('id, status, accepted_user_id')
    .eq('id', id)
    .maybeSingle()
  if (!invitation) return { status: 404, body: { error: 'invitation_not_found' } }

  if (invitation.status === 'accepted' && invitation.accepted_user_id) {
    // L'accès est suspendu (réversible à la main), jamais supprimé.
    const { error } = await db
      .from('pro_memberships')
      .update({ status: 'suspended' })
      .eq('user_id', invitation.accepted_user_id)
      .eq('access_level', 'pro')
    if (error) return { status: 500, body: { error: 'membership_write_failed' } }
  }
  const { error } = await db.from('pro_invitations').update({ status: 'revoked' }).eq('id', id)
  if (error) return { status: 500, body: { error: 'invitation_write_failed' } }
  return { status: 200, body: { ok: true } }
}
