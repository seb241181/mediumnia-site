import { readFile, writeFile } from 'node:fs/promises'

const transactionalEmailPath = new URL('../lib/transactionalEmail.js', import.meta.url)
const oracleApiPath = new URL('../api/oracle-interpret.js', import.meta.url)
const oracleTestPath = new URL('../src/components/OracleTest.jsx', import.meta.url)
const analyticsPath = new URL('../lib/mediumiaAnalytics.js', import.meta.url)
const legalPagesPath = new URL('../src/components/LegalPages.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`MediumIA Oracle email-sequence patch drift: ${label}`)
  return source.replace(before, after)
}

const transactionalEmail = await readFile(transactionalEmailPath, 'utf8')
for (const [needle, label] of [
  ['scheduledAt', 'scheduled sends'],
  ['payload.scheduled_at', 'Resend scheduled_at payload'],
  ['export async function cancelScheduledEmail', 'scheduled email cancellation'],
  ['/cancel', 'Resend cancel endpoint'],
]) {
  if (!transactionalEmail.includes(needle)) {
    throw new Error(`MediumIA Oracle email-sequence helper missing: ${label}`)
  }
}

let oracleApi = await readFile(oracleApiPath, 'utf8')
oracleApi = replaceRequired(
  oracleApi,
  `import { handleOracleTimeline } from '../lib/oracleTimeline.js'`,
  `import { handleOracleTimeline } from '../lib/oracleTimeline.js'\nimport { createOracleEmailSequenceProof, handleOracleEmailSequence } from '../lib/oracleEmailSequence.js'`,
  'Oracle email-sequence import',
)
oracleApi = replaceRequired(
  oracleApi,
  `  if (req.query?.mode === 'chronosphere') {\n    return handleOracleTimeline(req, res)\n  }\n\n  if (req.method !== 'POST') {`,
  `  if (req.query?.mode === 'chronosphere') {\n    return handleOracleTimeline(req, res)\n  }\n  if (req.query?.mode === 'email-sequence') {\n    return handleOracleEmailSequence(req, res)\n  }\n\n  if (req.method !== 'POST') {`,
  'Oracle email-sequence route reuse',
)
oracleApi = replaceRequired(
  oracleApi,
  `    return res.status(200).json({\n      interpretation,\n      emailStatus: 'sent',\n    })`,
  `    return res.status(200).json({\n      interpretation,\n      emailStatus: 'sent',\n      emailSequenceProof: createOracleEmailSequenceProof(normalizedEmail),\n    })`,
  'Oracle completed draw opt-in proof',
)
await writeFile(oracleApiPath, oracleApi)

let analytics = await readFile(analyticsPath, 'utf8')
analytics = replaceRequired(
  analytics,
  `  'conference_interest_click',\n])`,
  `  'conference_interest_click',\n  'oracle_email_optin_view',\n  'oracle_email_optin_completed',\n  'oracle_email_unsubscribed',\n])`,
  'Oracle email-sequence metric allowlist',
)
await writeFile(analyticsPath, analytics)

let oracleTest = await readFile(oracleTestPath, 'utf8')
oracleTest = replaceRequired(
  oracleTest,
  `import { useState } from 'react'`,
  `import { useEffect, useState } from 'react'`,
  'OracleTest useEffect import',
)
oracleTest = replaceRequired(
  oracleTest,
  `  const [result, setResult]   = useState(null)`,
  `  const [result, setResult]   = useState(null)\n  const [emailOptIn, setEmailOptIn] = useState(false)\n  const [sequenceLoading, setSequenceLoading] = useState(false)\n  const [sequenceDone, setSequenceDone] = useState(false)\n  const [sequenceMessage, setSequenceMessage] = useState('')\n  const [sequenceError, setSequenceError] = useState(false)\n  const [unsubscribeMessage, setUnsubscribeMessage] = useState('')\n  const [unsubscribeError, setUnsubscribeError] = useState(false)`,
  'OracleTest email-sequence state',
)
oracleTest = replaceRequired(
  oracleTest,
  `      const { interpretation, emailStatus } = await apiRes.json()`,
  `      const { interpretation, emailStatus, emailSequenceProof } = await apiRes.json()`,
  'OracleTest sequence proof response',
)
oracleTest = replaceRequired(
  oracleTest,
  `      setResult({ cards: drawnCards, interpretation })\n      trackMediumiaMetric('oracle_free_draw_completed', 'oracle')`,
  `      setResult({ cards: drawnCards, interpretation, emailSequenceProof })\n      trackMediumiaMetric('oracle_free_draw_completed', 'oracle')\n      if (emailSequenceProof) trackMediumiaMetric('oracle_email_optin_view', 'oracle')`,
  'OracleTest opt-in view metric',
)
const oracleHandlers = `\n  async function handleSequenceOptIn() {\n    if (!emailOptIn || sequenceLoading || sequenceDone || !result?.emailSequenceProof) return\n    setSequenceLoading(true)\n    setSequenceMessage('')\n    setSequenceError(false)\n    try {\n      const res = await fetch('/api/oracle-interpret?mode=email-sequence', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({\n          action: 'subscribe',\n          email: email.toLowerCase().trim(),\n          proof: result.emailSequenceProof,\n          consent: true,\n        }),\n      })\n      const body = await res.json().catch(() => ({}))\n      if (res.status === 409) {\n        setSequenceMessage('Votre demande est déjà en cours. Vérifiez votre boîte e-mail dans quelques instants.')\n        return\n      }\n      if (!res.ok) throw new Error(body.error || 'sequence_unavailable')\n      setSequenceDone(true)\n      setSequenceMessage('C’est parti ✦ Le premier exercice arrivera par e-mail dans quelques minutes, puis les deux suivants à J+2 et J+4.')\n      trackMediumiaMetric('oracle_email_optin_completed', 'oracle')\n    } catch {\n      setSequenceError(true)\n      setSequenceMessage('La séquence n’a pas pu être programmée pour le moment. Vous pouvez réessayer sans refaire votre tirage.')\n    } finally {\n      setSequenceLoading(false)\n    }\n  }\n\n  useEffect(() => {\n    if (typeof window === 'undefined') return\n    const prefix = '#desinscription='\n    if (!window.location.hash.startsWith(prefix)) return\n\n    let token = ''\n    try {\n      token = decodeURIComponent(window.location.hash.slice(prefix.length))\n    } catch {\n      setUnsubscribeError(true)\n      setUnsubscribeMessage('Ce lien de désinscription n’est pas valide.')\n      return\n    }\n\n    window.history.replaceState(null, '', window.location.pathname + window.location.search)\n    setUnsubscribeMessage('Désinscription en cours…')\n    setUnsubscribeError(false)\n\n    fetch('/api/oracle-interpret?mode=email-sequence', {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({ action: 'unsubscribe', token }),\n    })\n      .then(async (res) => {\n        const body = await res.json().catch(() => ({}))\n        if (!res.ok) throw new Error(body.error || 'unsubscribe_failed')\n        setUnsubscribeMessage('Votre désinscription est enregistrée. Les e-mails encore programmés sont annulés.')\n        trackMediumiaMetric('oracle_email_unsubscribed', 'oracle')\n      })\n      .catch(() => {\n        setUnsubscribeError(true)\n        setUnsubscribeMessage('La désinscription n’a pas pu être confirmée. Merci de réessayer depuis le lien de votre e-mail.')\n      })\n  }, [])\n`
oracleTest = replaceRequired(
  oracleTest,
  `\n  return (\n    <div className="border-2 border-gold/30 rounded-2xl p-8 bg-white/70">`,
  `${oracleHandlers}\n  return (\n    <div className="border-2 border-gold/30 rounded-2xl p-8 bg-white/70">`,
  'OracleTest sequence handlers',
)
oracleTest = replaceRequired(
  oracleTest,
  `      <form onSubmit={handleSubmit} className="space-y-5">`,
  `      {unsubscribeMessage && (\n        <div className={\`mb-6 rounded-xl border px-4 py-3 font-georgia text-sm \${unsubscribeError ? 'border-red-300 bg-red-50 text-red-700' : 'border-gold/30 bg-gold/10 text-deep'}\`}>\n          {unsubscribeMessage}\n        </div>\n      )}\n      <form onSubmit={handleSubmit} className="space-y-5">`,
  'OracleTest unsubscribe feedback',
)
const interpretationLine = `          <p className="font-georgia text-base md:text-lg text-deep italic leading-relaxed whitespace-pre-line">{result.interpretation}</p>`
const optInBlock = `${interpretationLine}\n          {result.emailSequenceProof && (\n            <div className="mt-9 rounded-2xl border-2 border-gold/30 bg-cream/70 p-5 md:p-6">\n              <p className="font-georgia text-xs uppercase tracking-[0.18em] text-gold mb-2">POURSUIVRE L’EXPÉRIENCE</p>\n              <h3 className="font-georgia text-xl md:text-2xl font-medium text-deep mb-3">Recevez gratuitement 3 exercices MediumIA</h3>\n              <p className="font-georgia text-sm text-mist leading-relaxed mb-5">\n                Trois expériences issues de la Formation MediumIA pour explorer l’intention, la perception et le discernement. Le premier e-mail arrive dans quelques minutes, puis les suivants à J+2 et J+4.\n              </p>\n              <label className="flex items-start gap-3 rounded-xl border border-gold/20 bg-white/70 p-4 cursor-pointer">\n                <input\n                  type="checkbox"\n                  checked={emailOptIn}\n                  onChange={(e) => setEmailOptIn(e.target.checked)}\n                  disabled={sequenceDone}\n                  className="mt-1 h-4 w-4 accent-[#C9A84C]"\n                />\n                <span className="font-georgia text-sm text-deep leading-relaxed">\n                  Je souhaite recevoir gratuitement les 3 exercices MediumIA par e-mail et découvrir à la fin la Formation MediumIA. Je peux me désinscrire à tout moment.\n                </span>\n              </label>\n              <p className="font-georgia text-xs text-mist mt-3 leading-relaxed">\n                3 e-mails seulement. Cette demande ne vous inscrit pas automatiquement à une newsletter générale. Voir notre <a href="/confidentialite" className="text-gold hover:underline">politique de confidentialité</a>.\n              </p>\n              <button\n                type="button"\n                onClick={handleSequenceOptIn}\n                disabled={!emailOptIn || sequenceLoading || sequenceDone}\n                className="mt-5 w-full md:w-auto rounded-lg bg-gold px-6 py-3.5 font-georgia text-sm font-bold text-deep transition-opacity hover:opacity-90 disabled:opacity-45"\n              >\n                {sequenceLoading ? 'Programmation…' : sequenceDone ? 'Mes 3 exercices sont programmés ✓' : 'Recevoir mes 3 exercices →'}\n              </button>\n              {sequenceMessage && (\n                <p className={\`mt-4 font-georgia text-sm \${sequenceError ? 'text-red-600' : 'text-deep'}\`}>{sequenceMessage}</p>\n              )}\n            </div>\n          )}`
oracleTest = replaceRequired(
  oracleTest,
  interpretationLine,
  optInBlock,
  'OracleTest opt-in block',
)
await writeFile(oracleTestPath, oracleTest)

let legalPages = await readFile(legalPagesPath, 'utf8')
const legalAnchor = `      <Section title="Données collectées — Essai MediumIA">`
const legalSection = `      <Section title="Séquence gratuite — 3 exercices MediumIA">\n        <p>\n          Après votre tirage Oracle gratuit, vous pouvez demander facultativement une séquence limitée à trois e-mails\n          contenant des exercices issus de la Formation MediumIA. Cette demande est distincte du tirage gratuit et ne conditionne jamais l’accès au résultat.\n        </p>\n        <p>\n          Base légale : votre consentement explicite, donné au moyen d’une case dédiée non pré-cochée.\n          La séquence comprend uniquement trois e-mails et ne constitue pas une inscription automatique à une newsletter générale.\n        </p>\n        <p>\n          L’adresse e-mail est transmise à Resend au moment de la programmation des trois envois. MediumIA ne conserve pas cette adresse en clair dans Supabase pour cette séquence :\n          la base conserve uniquement un hash de l’adresse, la date et la version du consentement, le statut de la séquence, les identifiants techniques des envois programmés\n          et le hash du jeton de désinscription.\n        </p>\n        <p>\n          Chaque e-mail contient un lien de désinscription. En cas de retrait du consentement, MediumIA enregistre immédiatement la désinscription et demande l’annulation des envois encore programmés auprès de Resend.\n        </p>\n      </Section>\n\n${legalAnchor}`
legalPages = replaceRequired(
  legalPages,
  legalAnchor,
  legalSection,
  'privacy policy Oracle email sequence',
)
legalPages = replaceRequired(
  legalPages,
  `<li>Resend — emails transactionnels</li>`,
  `<li>Resend — emails transactionnels et séquences e-mail demandées par consentement</li>`,
  'privacy policy Resend role',
)
await writeFile(legalPagesPath, legalPages)

console.log('MediumIA Oracle email sequence: consent UI, scheduled emails, unsubscribe and privacy copy applied')
