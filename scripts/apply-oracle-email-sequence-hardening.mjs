import { readFile, writeFile } from 'node:fs/promises'

const sequencePath = new URL('../lib/oracleEmailSequence.js', import.meta.url)
const oracleTestPath = new URL('../src/components/OracleTest.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA Oracle email hardening patch drift: ${label}`)
  return source.replace(before, after)
}

let sequence = await readFile(sequencePath, 'utf8')

sequence = replaceRequired(
  sequence,
  `  if (existing.status === 'active') return { conflict: 'active' }\n  if (existing.status === 'pending') {`,
  `  if (existing.status === 'active') return { conflict: 'active' }\n  if (existing.status === 'failed' && Array.isArray(existing.resend_email_ids) && existing.resend_email_ids.length) {\n    return { conflict: 'cleanup_pending', cleanupIds: existing.resend_email_ids, subscriptionId: existing.id }\n  }\n  if (existing.status === 'pending') {`,
  'failed subscription cleanup guard',
)

sequence = replaceRequired(
  sequence,
  `  const reservation = await reserveSubscription(supabase, emailHash, tokenHash)\n  if (reservation.conflict === 'active') {\n    return res.status(200).json({ status: 'already_subscribed' })\n  }\n  if (reservation.conflict) {\n    return res.status(409).json({ error: 'sequence_subscription_in_progress' })\n  }`,
  `  let reservation = await reserveSubscription(supabase, emailHash, tokenHash)\n  if (reservation.conflict === 'active') {\n    return res.status(200).json({ status: 'already_subscribed' })\n  }\n  if (reservation.conflict === 'cleanup_pending') {\n    const cleanupResults = await cancelEmailIds(reservation.cleanupIds)\n    const cleanupStillPending = cleanupResults.some((result) => result.status === 'error' || result.status === 'not_configured')\n    if (cleanupStillPending) {\n      return res.status(409).json({ error: 'sequence_cleanup_pending' })\n    }\n    await setSubscriptionState(supabase, reservation.subscriptionId, 'failed', [])\n    reservation = await reserveSubscription(supabase, emailHash, tokenHash)\n  }\n  if (reservation.conflict) {\n    return res.status(409).json({ error: 'sequence_subscription_in_progress' })\n  }`,
  'cleanup before retry',
)

sequence = replaceRequired(
  sequence,
  `    await cancelEmailIds(scheduledIds)\n    try {\n      await setSubscriptionState(supabase, subscriptionId, 'failed', scheduledIds)`,
  `    const cancellationResults = await cancelEmailIds(scheduledIds)\n    const cleanupPending = cancellationResults.some((result) => result.status === 'error' || result.status === 'not_configured')\n    try {\n      await setSubscriptionState(supabase, subscriptionId, 'failed', cleanupPending ? scheduledIds : [])`,
  'persist only unresolved scheduled emails',
)

await writeFile(sequencePath, sequence)

let oracleTest = await readFile(oracleTestPath, 'utf8')

oracleTest = replaceRequired(
  oracleTest,
  `      if (res.status === 409) {\n        setSequenceMessage('Votre demande est déjà en cours. Vérifiez votre boîte e-mail dans quelques instants.')\n        return\n      }`,
  `      if (res.status === 409) {\n        setSequenceMessage(body.error === 'sequence_cleanup_pending'\n          ? 'Une ancienne programmation est encore en cours d’annulation. Réessayez dans quelques instants : aucun nouvel envoi ne sera ajouté tant que le nettoyage n’est pas terminé.'\n          : 'Votre demande est déjà en cours. Vérifiez votre boîte e-mail dans quelques instants.')\n        return\n      }`,
  'cleanup-pending opt-in feedback',
)

oracleTest = replaceRequired(
  oracleTest,
  `        setUnsubscribeMessage('Votre désinscription est enregistrée. Les e-mails encore programmés sont annulés.')\n        trackMediumiaMetric('oracle_email_unsubscribed', 'oracle')`,
  `        setUnsubscribeMessage(body.cancellationPending\n          ? 'Votre désinscription est enregistrée. L’annulation des envois encore programmés est en cours. Vous pouvez réutiliser ce lien dans quelques instants pour vérifier.'\n          : 'Votre désinscription est enregistrée. Les e-mails encore programmés ont été annulés.')\n        trackMediumiaMetric('oracle_email_unsubscribed', 'oracle')`,
  'accurate unsubscribe cancellation feedback',
)

await writeFile(oracleTestPath, oracleTest)

console.log('MediumIA Oracle email sequence: partial scheduling and unsubscribe hardening applied')
