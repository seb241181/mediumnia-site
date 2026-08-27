#!/usr/bin/env node
/**
 * Oracle Step 6 — Tests end-to-end
 *
 * Usage :
 *   node oracle-step6-tests.mjs <PREVIEW_URL> <SUPABASE_URL> <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Exemple :
 *   node oracle-step6-tests.mjs \
 *     "https://mediumia-site-clz59am0j-seguins-projects-a1d4673f.vercel.app" \
 *     "https://xxxx.supabase.co" \
 *     "eyJhbG..."
 *
 * Le share token est déjà intégré. Le script :
 *   1. Envoie un premier tirage avec un email test → attend 200
 *   2. Vérifie que l'interprétation est générée et l'email envoyé
 *   3. Vérifie dans Supabase que le statut est passé à « completed »
 *   4. Renvoie le même email → attend 409
 *   5. Confirme que la 409 n'a pas déclenché OpenAI ni Resend
 *   6. Renvoie avec majuscules/espaces → attend 409 (normalisation)
 *   7. Supprime la ligne test dans Supabase
 */

const SHARE_TOKEN = 'TZEl0c27EBjT3VguVbuD7K7r2nMTnqVJ'
const TEST_EMAIL = `claude-test-step6-${Date.now()}@example.com`
const TEST_CARD_IDS = [3, 17, 42]

const args = process.argv.slice(2)
if (args.length < 3) {
  console.error('Usage: node oracle-step6-tests.mjs <PREVIEW_URL> <SUPABASE_URL> <SUPABASE_SERVICE_ROLE_KEY>')
  process.exit(1)
}

const [PREVIEW_URL, SUPABASE_URL, SUPABASE_KEY] = args
const API_URL = `${PREVIEW_URL.replace(/\/$/, '')}/api/oracle-interpret?_vercel_share=${SHARE_TOKEN}`

const { createHash } = await import('node:crypto')
const emailHash = createHash('sha256').update(TEST_EMAIL.trim().toLowerCase()).digest('hex')

let passed = 0
let failed = 0

function ok(test, msg) { passed++; console.log(`  ✓ ${test}: ${msg}`) }
function fail(test, msg) { failed++; console.error(`  ✗ ${test}: ${msg}`) }

async function supabaseQuery(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (opts.expectEmpty && res.status === 200) {
    const data = await res.json()
    return data
  }
  return { status: res.status, data: await res.json().catch(() => null) }
}

async function callOracle(email, cardIds) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, cardIds }),
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

console.log('\n═══════════════════════════════════════════')
console.log('  Oracle Step 6 — Tests end-to-end')
console.log('═══════════════════════════════════════════')
console.log(`  Email test : ${TEST_EMAIL}`)
console.log(`  Hash SHA-256: ${emailHash}`)
console.log(`  Cartes     : ${TEST_CARD_IDS.join(', ')}`)
console.log(`  API URL    : ${API_URL.substring(0, 80)}...`)
console.log('───────────────────────────────────────────\n')

// ═══ TEST 1 : Premier tirage → 200 ═══
console.log('TEST 1 — Premier tirage (email neuf → 200)')
const t1 = await callOracle(TEST_EMAIL, TEST_CARD_IDS)
if (t1.status === 200) {
  ok('HTTP 200', `Statut ${t1.status}`)
} else {
  fail('HTTP 200', `Attendu 200, reçu ${t1.status} — ${JSON.stringify(t1.body)}`)
}

// ═══ TEST 2 : Interprétation + email ═══
console.log('\nTEST 2 — Interprétation générée + email envoyé')
if (t1.status === 200 && t1.body) {
  if (t1.body.interpretation && t1.body.interpretation.length > 50) {
    ok('Interprétation', `${t1.body.interpretation.length} caractères`)
  } else {
    fail('Interprétation', `Texte trop court ou absent: ${JSON.stringify(t1.body.interpretation?.substring(0, 100))}`)
  }
  if (t1.body.emailStatus === 'sent') {
    ok('Email Resend', 'emailStatus = sent')
  } else if (t1.body.emailStatus === 'not_configured') {
    fail('Email Resend', 'emailStatus = not_configured — RESEND_API_KEY / RESEND_FROM_EMAIL non configuré sur la Preview')
  } else {
    fail('Email Resend', `emailStatus = ${t1.body.emailStatus}`)
  }
} else {
  fail('Interprétation', 'Test 1 a échoué, impossible de vérifier')
  fail('Email Resend', 'Test 1 a échoué, impossible de vérifier')
}

// ═══ TEST 3 : Supabase row → completed ═══
console.log('\nTEST 3 — Supabase : statut completed')
const t3 = await supabaseQuery(`oracle_free_draws?email_hash=eq.${emailHash}&select=id,email_hash,status,created_at,completed_at`)
if (t3.status === 200 && Array.isArray(t3.data) && t3.data.length === 1) {
  const row = t3.data[0]
  if (row.status === 'completed') {
    ok('Statut completed', `id=${row.id}, completed_at=${row.completed_at}`)
  } else {
    fail('Statut completed', `Attendu completed, trouvé ${row.status}`)
  }
  if (row.email_hash === emailHash) {
    ok('Hash email', 'Correspond au SHA-256 de l\'email normalisé')
  } else {
    fail('Hash email', `Hash incorrect: ${row.email_hash}`)
  }
} else {
  fail('Row Supabase', `Attendu 1 ligne, status=${t3.status}, data=${JSON.stringify(t3.data)}`)
}

// ═══ TEST 4 : Même email → 409 ═══
console.log('\nTEST 4 — Même email → 409')
const t4 = await callOracle(TEST_EMAIL, TEST_CARD_IDS)
if (t4.status === 409) {
  ok('HTTP 409', `Statut ${t4.status}`)
  if (t4.body?.error === 'oracle_free_draw_already_used') {
    ok('Code erreur', t4.body.error)
  } else {
    fail('Code erreur', `Attendu oracle_free_draw_already_used, reçu ${t4.body?.error}`)
  }
} else {
  fail('HTTP 409', `Attendu 409, reçu ${t4.status} — ${JSON.stringify(t4.body)}`)
}

// ═══ TEST 5 : Sur 409, zéro appel OpenAI / Resend ═══
console.log('\nTEST 5 — Sur 409 : pas d\'interprétation ni d\'email')
if (t4.status === 409) {
  if (!t4.body?.interpretation) {
    ok('Pas d\'interprétation', 'Aucun champ interpretation dans la 409')
  } else {
    fail('Pas d\'interprétation', 'Le champ interpretation est présent — OpenAI a été appelé inutilement')
  }
  if (!t4.body?.emailStatus) {
    ok('Pas d\'email', 'Aucun champ emailStatus dans la 409')
  } else {
    fail('Pas d\'email', 'Le champ emailStatus est présent — Resend a été appelé inutilement')
  }
} else {
  fail('Vérification 409', 'Test 4 n\'a pas retourné 409, impossible de vérifier')
}

// ═══ TEST 6 : Email avec majuscules/espaces → 409 (normalisation) ═══
console.log('\nTEST 6 — Email avec majuscules/espaces → 409 (normalisation)')
const noisyEmail = `  ${TEST_EMAIL.substring(0, 5).toUpperCase()}${TEST_EMAIL.substring(5)}  `
console.log(`  Email envoyé : "${noisyEmail}"`)
const t6 = await callOracle(noisyEmail, TEST_CARD_IDS)
if (t6.status === 409) {
  ok('Normalisation', `"${noisyEmail}" → 409, email correctement normalisé`)
} else {
  fail('Normalisation', `Attendu 409, reçu ${t6.status} — la normalisation (trim+lowercase) ne fonctionne pas`)
}

// ═══ TEST 7 : Suppression de la ligne test ═══
console.log('\nTEST 7 — Suppression de la ligne test Supabase')
const t7del = await fetch(`${SUPABASE_URL}/rest/v1/oracle_free_draws?email_hash=eq.${emailHash}`, {
  method: 'DELETE',
  headers: {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
})
const t7body = await t7del.json().catch(() => null)
if (t7del.status === 200 && Array.isArray(t7body) && t7body.length === 1) {
  ok('Suppression', `Ligne ${t7body[0].id} supprimée — email test nettoyé`)
} else if (t7del.status === 200 && Array.isArray(t7body) && t7body.length === 0) {
  fail('Suppression', 'Aucune ligne trouvée à supprimer — déjà nettoyée ?')
} else {
  fail('Suppression', `Erreur: status=${t7del.status}, body=${JSON.stringify(t7body)}`)
}

// Vérification finale
const t7check = await supabaseQuery(`oracle_free_draws?email_hash=eq.${emailHash}&select=id`)
if (t7check.status === 200 && Array.isArray(t7check.data) && t7check.data.length === 0) {
  ok('Vérification post-suppression', 'Aucune ligne résiduelle')
} else {
  fail('Vérification post-suppression', `Ligne(s) résiduelle(s): ${JSON.stringify(t7check.data)}`)
}

// ═══ RAPPORT ═══
console.log('\n═══════════════════════════════════════════')
console.log(`  RÉSULTAT : ${passed} passés, ${failed} échoués`)
console.log('═══════════════════════════════════════════\n')

process.exit(failed > 0 ? 1 : 0)
