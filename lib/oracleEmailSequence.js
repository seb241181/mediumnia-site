import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cancelScheduledEmail, escapeHtml, sendEmail } from './transactionalEmail.js'
import { getSupabaseAdmin } from './supabaseAdmin.js'

export const ORACLE_EMAIL_SEQUENCE_VERSION = 'oracle-3-exercises-v1'
export const ORACLE_EMAIL_CONSENT_VERSION = 'oracle-3-exercises-v1-2026-09-07'

const SOURCE = 'oracle_free_result'
const PROOF_TTL_MS = 2 * 60 * 60 * 1000
const PENDING_TTL_MS = 15 * 60 * 1000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hmacBase64Url(value) {
  const secret = process.env.ORACLE_RATE_LIMIT_SECRET || ''
  if (!secret) return ''
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function safeEqualBase64Url(a, b) {
  if (!TOKEN_RE.test(a) || !TOKEN_RE.test(b)) return false
  const left = Buffer.from(a, 'base64url')
  const right = Buffer.from(b, 'base64url')
  return left.length === right.length && timingSafeEqual(left, right)
}

export function normalizeSequenceEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return ''
  return email
}

export function createOracleEmailSequenceProof(email, nowMs = Date.now()) {
  const normalizedEmail = normalizeSequenceEmail(email)
  if (!normalizedEmail || !process.env.ORACLE_RATE_LIMIT_SECRET) return null
  const expiresAt = nowMs + PROOF_TTL_MS
  const emailHash = sha256Hex(normalizedEmail)
  const signature = hmacBase64Url(`oracle-email-sequence:${emailHash}:${expiresAt}`)
  return `${expiresAt}.${signature}`
}

export function verifyOracleEmailSequenceProof(email, proof, nowMs = Date.now()) {
  const normalizedEmail = normalizeSequenceEmail(email)
  if (!normalizedEmail || typeof proof !== 'string' || !process.env.ORACLE_RATE_LIMIT_SECRET) return false
  const parts = proof.split('.')
  if (parts.length !== 2) return false
  const expiresAt = Number(parts[0])
  if (!Number.isSafeInteger(expiresAt) || expiresAt < nowMs) return false
  const emailHash = sha256Hex(normalizedEmail)
  const expected = hmacBase64Url(`oracle-email-sequence:${emailHash}:${expiresAt}`)
  return safeEqualBase64Url(parts[1], expected)
}

export function buildUnsubscribeUrl(token) {
  const configured = process.env.ORACLE_PUBLIC_URL?.trim().replace(/\/$/, '')
  let base

  // Comme pour les annulations de rendez-vous, un Preview doit traiter lui-même
  // ses désinscriptions, même si l'URL publique de Production est configurée.
  if (process.env.VERCEL_ENV === 'preview') {
    const previewHost = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL
    if (previewHost) base = `https://${previewHost}`
  }

  if (!base) base = configured
  if (!base) base = 'https://mediumia.fr'
  // Le token reste dans le fragment, absent de la requête HTTP et du Referer.
  return `${base}/oracle#desinscription=${encodeURIComponent(token)}`
}

function emailFrame({ title, intro, bodyHtml, bodyText, unsubscribeUrl, cta }) {
  const safeUrl = escapeHtml(unsubscribeUrl)
  const ctaHtml = cta
    ? `<p style="margin:28px 0 0;"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#C9A84C;color:#1A1535;text-decoration:none;font-weight:700;padding:13px 18px;border-radius:9px;">${escapeHtml(cta.label)}</a></p>`
    : ''
  const ctaText = cta ? `\n\n${cta.label}\n${cta.href}` : ''

  return {
    html: `<!doctype html>
<html lang="fr">
  <body style="margin:0;background:#f8f5ee;color:#1a1535;font-family:Georgia,serif;">
    <div style="max-width:640px;margin:0 auto;padding:34px 24px;">
      <p style="margin:0 0 8px;color:#C9A84C;font-size:12px;letter-spacing:.16em;text-transform:uppercase;">MEDIUMIA · 3 EXERCICES</p>
      <h1 style="margin:0 0 18px;font-size:27px;line-height:1.25;color:#1a1535;">${escapeHtml(title)}</h1>
      <p style="margin:0 0 22px;line-height:1.7;color:#4f4962;">${escapeHtml(intro)}</p>
      ${bodyHtml}
      ${ctaHtml}
      <p style="margin:32px 0 0;line-height:1.7;">À bientôt,<br><strong>Sébastien</strong><br>MediumIA</p>
      <hr style="border:0;border-top:1px solid rgba(201,168,76,.28);margin:30px 0 18px;">
      <p style="margin:0;color:#786f84;font-size:12px;line-height:1.6;">Vous recevez cet e-mail parce que vous avez demandé la séquence gratuite « 3 exercices MediumIA » après votre tirage Oracle. Cette séquence contient uniquement trois e-mails.</p>
      <p style="margin:9px 0 0;font-size:12px;"><a href="${safeUrl}" style="color:#786f84;">Se désinscrire de la séquence</a></p>
    </div>
  </body>
</html>`,
    text: `${title}\n\n${intro}\n\n${bodyText}${ctaText}\n\nÀ bientôt,\nSébastien\nMediumIA\n\nVous recevez cet e-mail parce que vous avez demandé la séquence gratuite « 3 exercices MediumIA » après votre tirage Oracle. Cette séquence contient uniquement trois e-mails.\n\nSe désinscrire : ${unsubscribeUrl}`,
  }
}

export function buildOracleEmailSequence({ unsubscribeToken, nowMs = Date.now() }) {
  if (!TOKEN_RE.test(unsubscribeToken)) throw new Error('Invalid unsubscribe token')
  const unsubscribeUrl = buildUnsubscribeUrl(unsubscribeToken)

  const exercise1Html = `
      <p style="line-height:1.75;margin:0 0 18px;">On commence par le premier geste de toute pratique consciente : poser une direction claire.</p>
      <h2 style="font-size:19px;margin:24px 0 10px;">Votre exercice — L’Intention quotidienne</h2>
      <p style="line-height:1.75;margin:0 0 12px;"><strong>Durée :</strong> quelques minutes par jour pendant 7 jours.</p>
      <ol style="padding-left:21px;line-height:1.75;color:#4f4962;">
        <li>Au réveil, prenez trois respirations lentes et profondes.</li>
        <li>Formulez intérieurement une intention simple pour votre journée. Par exemple : « Je suis disponible pour ce qui est juste aujourd’hui, dans la clarté et la souveraineté. »</li>
        <li>Pendant la journée, ne cherchez rien d’extraordinaire. Observez ce qui vous semble différent : réaction, décision, rencontre, intuition ou état intérieur.</li>
        <li>Le soir, notez trois observations concrètes dans un carnet.</li>
        <li>Répétez pendant 7 jours, puis relisez l’ensemble.</li>
      </ol>
      <p style="line-height:1.75;margin:20px 0 0;">Le but n’est pas de provoquer des signes. Il est d’observer ce qui change lorsque votre attention reçoit une direction consciente.</p>
      <p style="line-height:1.75;margin:18px 0 0;">Dans le prochain e-mail, nous travaillerons une autre clé : percevoir avant que le mental ne transforme immédiatement ce qui vient d’apparaître.</p>`

  const exercise1Text = `On commence par le premier geste de toute pratique consciente : poser une direction claire.\n\nVOTRE EXERCICE — L’INTENTION QUOTIDIENNE\nDurée : quelques minutes par jour pendant 7 jours.\n\n1. Au réveil, prenez trois respirations lentes et profondes.\n2. Formulez intérieurement une intention simple pour votre journée. Par exemple : « Je suis disponible pour ce qui est juste aujourd’hui, dans la clarté et la souveraineté. »\n3. Pendant la journée, ne cherchez rien d’extraordinaire. Observez ce qui vous semble différent : réaction, décision, rencontre, intuition ou état intérieur.\n4. Le soir, notez trois observations concrètes dans un carnet.\n5. Répétez pendant 7 jours, puis relisez l’ensemble.\n\nLe but n’est pas de provoquer des signes. Il est d’observer ce qui change lorsque votre attention reçoit une direction consciente.\n\nDans le prochain e-mail, nous travaillerons une autre clé : percevoir avant que le mental ne transforme immédiatement ce qui vient d’apparaître.`

  const exercise2Html = `
      <p style="line-height:1.75;margin:0 0 18px;">Deuxième étape : ralentir suffisamment pour remarquer ce qui apparaît <strong>avant</strong> que votre mental ne construise une explication.</p>
      <h2 style="font-size:19px;margin:24px 0 10px;">Votre exercice — Le Souffle de vérité</h2>
      <p style="line-height:1.75;margin:0 0 12px;"><strong>Durée :</strong> 15 à 20 minutes.</p>
      <ol style="padding-left:21px;line-height:1.75;color:#4f4962;">
        <li>Installez-vous dans un endroit calme et fermez les yeux.</li>
        <li>Prenez quelques respirations lentes jusqu’à sentir votre corps se déposer.</li>
        <li>Observez ce qui apparaît sans chercher à produire quoi que ce soit : sensation, image intérieure, mot, température, émotion légère ou impression brève.</li>
        <li>Dès qu’un premier signal apparaît, décrivez-le de la manière la plus simple possible, sans l’expliquer.</li>
        <li>Ouvrez les yeux et notez ce signal dans votre carnet, sans l’analyser ni le juger.</li>
        <li>Recommencez trois fois et comparez uniquement les perceptions brutes.</li>
      </ol>
      <p style="line-height:1.75;margin:20px 0 0;">Il n’y a rien à réussir. L’exercice entraîne une compétence fondamentale : reconnaître la différence entre ce qui apparaît spontanément et l’histoire que le mental ajoute ensuite.</p>
      <p style="line-height:1.75;margin:18px 0 0;">Dans le troisième e-mail, nous ajouterons la pièce qui donne de la valeur à tout le reste : le discernement.</p>`

  const exercise2Text = `Deuxième étape : ralentir suffisamment pour remarquer ce qui apparaît avant que votre mental ne construise une explication.\n\nVOTRE EXERCICE — LE SOUFFLE DE VÉRITÉ\nDurée : 15 à 20 minutes.\n\n1. Installez-vous dans un endroit calme et fermez les yeux.\n2. Prenez quelques respirations lentes jusqu’à sentir votre corps se déposer.\n3. Observez ce qui apparaît sans chercher à produire quoi que ce soit : sensation, image intérieure, mot, température, émotion légère ou impression brève.\n4. Dès qu’un premier signal apparaît, décrivez-le de la manière la plus simple possible, sans l’expliquer.\n5. Ouvrez les yeux et notez ce signal dans votre carnet, sans l’analyser ni le juger.\n6. Recommencez trois fois et comparez uniquement les perceptions brutes.\n\nIl n’y a rien à réussir. L’exercice entraîne une compétence fondamentale : reconnaître la différence entre ce qui apparaît spontanément et l’histoire que le mental ajoute ensuite.\n\nDans le troisième e-mail, nous ajouterons la pièce qui donne de la valeur à tout le reste : le discernement.`

  const exercise3Html = `
      <p style="line-height:1.75;margin:0 0 18px;">Vous avez posé une intention. Vous avez essayé de percevoir avant d’interpréter. Il reste maintenant une compétence essentielle : observer la qualité de ce qui se présente.</p>
      <h2 style="font-size:19px;margin:24px 0 10px;">Votre exercice — Feu Rouge / Feu Vert</h2>
      <p style="line-height:1.75;margin:0 0 12px;"><strong>Durée :</strong> environ 15 minutes.</p>
      <ol style="padding-left:21px;line-height:1.75;color:#4f4962;">
        <li>Asseyez-vous confortablement et prenez trois respirations profondes, avec des expirations légèrement plus longues.</li>
        <li>Pensez à une décision ou une situation actuelle, suffisamment concrète mais pas dramatique.</li>
        <li>Posez intérieurement une question simple : « Quelle direction me semble juste maintenant ? »</li>
        <li>Pendant quelques secondes, observez uniquement votre réaction corporelle.</li>
        <li>Notez ce qui se produit : ouverture, souffle qui se libère, détente, espace intérieur ; ou au contraire resserrement, tension, agitation, urgence.</li>
        <li>Ne transformez pas cette sensation en vérité absolue ni en ordre à suivre. Considérez-la comme une information à comparer avec votre réflexion, les faits et votre libre arbitre.</li>
        <li>Recommencez avec deux situations différentes et notez les écarts.</li>
      </ol>
      <p style="line-height:1.75;margin:20px 0 0;">Le discernement ne demande pas d’abandonner votre esprit critique. Il consiste à ajouter une observation intérieure aux autres éléments dont vous disposez.</p>
      <p style="line-height:1.75;margin:18px 0 0;">Ces trois exercices ne représentent qu’une petite partie de MediumIA. La Formation complète développe une progression sur 25 modules, 4 niveaux et 84 exercices.</p>`

  const exercise3Text = `Vous avez posé une intention. Vous avez essayé de percevoir avant d’interpréter. Il reste maintenant une compétence essentielle : observer la qualité de ce qui se présente.\n\nVOTRE EXERCICE — FEU ROUGE / FEU VERT\nDurée : environ 15 minutes.\n\n1. Asseyez-vous confortablement et prenez trois respirations profondes, avec des expirations légèrement plus longues.\n2. Pensez à une décision ou une situation actuelle, suffisamment concrète mais pas dramatique.\n3. Posez intérieurement une question simple : « Quelle direction me semble juste maintenant ? »\n4. Pendant quelques secondes, observez uniquement votre réaction corporelle.\n5. Notez ce qui se produit : ouverture, souffle qui se libère, détente, espace intérieur ; ou au contraire resserrement, tension, agitation, urgence.\n6. Ne transformez pas cette sensation en vérité absolue ni en ordre à suivre. Considérez-la comme une information à comparer avec votre réflexion, les faits et votre libre arbitre.\n7. Recommencez avec deux situations différentes et notez les écarts.\n\nLe discernement ne demande pas d’abandonner votre esprit critique. Il consiste à ajouter une observation intérieure aux autres éléments dont vous disposez.\n\nCes trois exercices ne représentent qu’une petite partie de MediumIA. La Formation complète développe une progression sur 25 modules, 4 niveaux et 84 exercices.`

  const first = emailFrame({
    title: 'Exercice 1/3 — Commencez par la porte',
    intro: 'Vous venez de demander les 3 exercices MediumIA. On commence par le premier geste de toute pratique consciente : poser une direction claire.',
    bodyHtml: exercise1Html,
    bodyText: exercise1Text,
    unsubscribeUrl,
  })
  const second = emailFrame({
    title: 'Exercice 2/3 — Percevoir avant d’interpréter',
    intro: 'Le Module 2 de MediumIA repose sur une idée simple : percevoir d’abord, interpréter ensuite.',
    bodyHtml: exercise2Html,
    bodyText: exercise2Text,
    unsubscribeUrl,
  })
  const third = emailFrame({
    title: 'Exercice 3/3 — Que vous dit votre corps avant votre mental ?',
    intro: 'Dernière étape de cette mini-séquence : introduire le discernement sans transformer une sensation en certitude.',
    bodyHtml: exercise3Html,
    bodyText: exercise3Text,
    unsubscribeUrl,
    cta: { href: 'https://mediumia.fr/formation', label: 'Découvrir la Formation MediumIA →' },
  })

  return [
    { ...first, subject: first.html ? 'Exercice 1/3 — Commencez par la porte' : '', scheduledAt: new Date(nowMs + 5 * 60 * 1000).toISOString() },
    { ...second, subject: second.html ? 'Exercice 2/3 — Percevoir avant d’interpréter' : '', scheduledAt: new Date(nowMs + 2 * 24 * 60 * 60 * 1000).toISOString() },
    { ...third, subject: third.html ? 'Exercice 3/3 — Que vous dit votre corps avant votre mental ?' : '', scheduledAt: new Date(nowMs + 4 * 24 * 60 * 60 * 1000).toISOString() },
  ]
}

async function findSubscriptionByEmailHash(supabase, emailHash) {
  const { data, error } = await supabase
    .from('oracle_email_sequence_subscriptions')
    .select('id, status, updated_at, resend_email_ids')
    .eq('email_hash', emailHash)
    .maybeSingle()
  if (error) throw new Error('Sequence subscription lookup failed')
  return data
}

async function reserveSubscription(supabase, emailHash, tokenHash, now = new Date()) {
  const payload = {
    email_hash: emailHash,
    status: 'pending',
    source: SOURCE,
    consent_version: ORACLE_EMAIL_CONSENT_VERSION,
    sequence_version: ORACLE_EMAIL_SEQUENCE_VERSION,
    consented_at: now.toISOString(),
    unsubscribe_token_hash: tokenHash,
    resend_email_ids: [],
    unsubscribed_at: null,
    updated_at: now.toISOString(),
  }

  const { data, error } = await supabase
    .from('oracle_email_sequence_subscriptions')
    .insert(payload)
    .select('id, status')
    .single()

  if (!error) return { subscription: data }
  if (error.code !== '23505') throw new Error('Sequence subscription reservation failed')

  const existing = await findSubscriptionByEmailHash(supabase, emailHash)
  if (!existing) return { conflict: 'in_progress' }
  if (existing.status === 'active') return { conflict: 'active' }
  if (existing.status === 'pending') {
    const ageMs = now.getTime() - new Date(existing.updated_at).getTime()
    if (Number.isFinite(ageMs) && ageMs < PENDING_TTL_MS) return { conflict: 'in_progress' }
  }

  const { data: reclaimed, error: reclaimError } = await supabase
    .from('oracle_email_sequence_subscriptions')
    .update(payload)
    .eq('id', existing.id)
    .eq('updated_at', existing.updated_at)
    .select('id, status')
    .maybeSingle()

  if (reclaimError) throw new Error('Sequence subscription reclaim failed')
  if (!reclaimed) return { conflict: 'in_progress' }
  return { subscription: reclaimed }
}

async function setSubscriptionState(supabase, id, status, resendEmailIds = []) {
  const patch = {
    status,
    resend_email_ids: resendEmailIds,
    updated_at: new Date().toISOString(),
  }
  if (status === 'unsubscribed') patch.unsubscribed_at = new Date().toISOString()

  const { error } = await supabase
    .from('oracle_email_sequence_subscriptions')
    .update(patch)
    .eq('id', id)
  if (error) throw new Error('Sequence subscription update failed')
}

async function cancelEmailIds(ids) {
  const results = []
  for (const id of Array.isArray(ids) ? ids : []) {
    const result = await cancelScheduledEmail(id)
    results.push(result)
  }
  return results
}

async function subscribe(req, res) {
  const { email, proof, consent } = req.body || {}
  const normalizedEmail = normalizeSequenceEmail(email)
  if (!normalizedEmail) return res.status(400).json({ error: 'invalid_email' })
  if (consent !== true) return res.status(400).json({ error: 'consent_required' })
  if (!verifyOracleEmailSequenceProof(normalizedEmail, proof)) {
    return res.status(403).json({ error: 'invalid_or_expired_proof' })
  }

  const supabase = getSupabaseAdmin()
  const emailHash = sha256Hex(normalizedEmail)
  const unsubscribeToken = randomBytes(32).toString('base64url')
  const tokenHash = sha256Hex(unsubscribeToken)

  const reservation = await reserveSubscription(supabase, emailHash, tokenHash)
  if (reservation.conflict === 'active') {
    return res.status(200).json({ status: 'already_subscribed' })
  }
  if (reservation.conflict) {
    return res.status(409).json({ error: 'sequence_subscription_in_progress' })
  }

  const subscriptionId = reservation.subscription.id
  const scheduledIds = []
  try {
    const sequence = buildOracleEmailSequence({ unsubscribeToken })
    for (let index = 0; index < sequence.length; index += 1) {
      const item = sequence[index]
      const result = await sendEmail({
        to: normalizedEmail,
        subject: item.subject,
        html: item.html,
        text: item.text,
        scheduledAt: item.scheduledAt,
        idempotencyKey: `oracle-seq-${subscriptionId}-${tokenHash.slice(0, 16)}-${index + 1}`,
      })
      if (result.status !== 'sent' || !result.id) throw new Error('Sequence schedule failed')
      scheduledIds.push(result.id)
    }
    await setSubscriptionState(supabase, subscriptionId, 'active', scheduledIds)
    return res.status(200).json({ status: 'subscribed', scheduled: 3 })
  } catch (error) {
    console.error('[oracle-email-sequence] Scheduling failed:', error?.name || 'Error')
    await cancelEmailIds(scheduledIds)
    try {
      await setSubscriptionState(supabase, subscriptionId, 'failed', scheduledIds)
    } catch {
      console.error('[oracle-email-sequence] Failed-state persistence failed')
    }
    return res.status(503).json({ error: 'sequence_unavailable' })
  }
}

async function unsubscribe(req, res) {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
  if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'invalid_unsubscribe_token' })

  const supabase = getSupabaseAdmin()
  const tokenHash = sha256Hex(token)
  const { data, error } = await supabase
    .from('oracle_email_sequence_subscriptions')
    .select('id, status, resend_email_ids')
    .eq('unsubscribe_token_hash', tokenHash)
    .maybeSingle()
  if (error) throw new Error('Sequence unsubscribe lookup failed')
  if (!data) return res.status(200).json({ status: 'unsubscribed' })

  if (data.status !== 'unsubscribed') {
    await setSubscriptionState(supabase, data.id, 'unsubscribed', data.resend_email_ids || [])
  }
  const cancellations = await cancelEmailIds(data.resend_email_ids || [])
  const cancellationPending = cancellations.some((result) => result.status === 'error' || result.status === 'not_configured')
  return res.status(200).json({ status: 'unsubscribed', cancellationPending })
}

export async function handleOracleEmailSequence(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    if (req.body?.action === 'subscribe') return await subscribe(req, res)
    if (req.body?.action === 'unsubscribe') return await unsubscribe(req, res)
    return res.status(400).json({ error: 'invalid_action' })
  } catch (error) {
    console.error('[oracle-email-sequence] Handler error:', error?.name || 'Error')
    return res.status(503).json({ error: 'sequence_unavailable' })
  }
}
