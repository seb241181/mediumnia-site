/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'

// Fonctions SQL réelles du Pass (réservation, libération, contrainte d'événements), exécutées
// sur une base PostgreSQL jetable copiée d'une réplique de TEST. Aucune base distante.
//   CONFERENCE_PASS_PG_TEMPLATE=<base modèle>  PGHOST=…  PGPORT=…  PGUSER=…  node --test tests/integration/conferencePassCheckout.postgres.test.js
const template = process.env.CONFERENCE_PASS_PG_TEMPLATE
const database = `conference_pass_it_${process.pid}`

function psql(db, sql) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout.trim()
}

function psqlAsync(db, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql])
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => (code === 0 ? resolve({ out: out.trim(), at: Date.now() }) : reject(new Error(err))))
  })
}

const json = (text) => JSON.parse(text.split('\n').filter(Boolean).pop())
const reserve = (hash, order, env = 'sandbox', cents = 100) =>
  `select public.reserve_conference_pass_checkout('${hash}', '${order}', '${env}', ${cents}, 'EUR', '${env === 'live' ? 'MEDIUMIA_CONFERENCE_PASS' : 'MEDIUMIA_CONFERENCE_PASS_SANDBOX'}')`
const release = (order) => `select public.release_conference_pass_checkout('${order}', 'test')`

// Un Pass par inscription : chaque Pass de test a sa propre inscription.
let addPass = () => {}

test('fonctions SQL réelles du Pass : réservation, libération, onglets concurrents', { skip: !template }, async (t) => {
  psql('postgres', `create database "${database}" template "${template}"`)
  t.after(() => psql('postgres', `drop database if exists "${database}"`))

  const ids = JSON.parse(psql(database, `
    with ev as (
      insert into public.conference_events (slug, title, pass_offer_enabled, pass_offer_amount_cents, pass_offer_currency)
      values ('it-pass-${process.pid}', 'Conférence test', true, 49900, 'EUR') returning id
    ), reg as (
      insert into public.conference_registrations (event_id, email, first_name)
      select id, 'pass-it@example.org', 'Test' from ev returning id, event_id
    ), p as (
      insert into public.conference_passes (event_id, registration_id, token_hash, expires_at, status)
      select event_id, id, 'hash-one', now() + interval '20 days', 'opened' from reg returning id
    ) select json_build_object('pass', (select id from p))`))

  addPass = (hash, fromPass) => psql(database, `
    with reg as (
      insert into public.conference_registrations (event_id, email, first_name)
      select event_id, '${hash}@example.org', 'Test' from public.conference_passes where id = '${fromPass}' returning id, event_id
    ) insert into public.conference_passes (event_id, registration_id, token_hash, expires_at, status)
      select event_id, id, '${hash}', now() + interval '20 days', 'opened' from reg`)

  await t.test('réservation idempotente ; une autre commande est refusée tant que la première est active', () => {
    assert.equal(json(psql(database, reserve('hash-one', 'ORDERA'))).ok, true)
    assert.equal(json(psql(database, reserve('hash-one', 'ORDERA'))).alreadyReserved, true)
    const other = json(psql(database, reserve('hash-one', 'ORDERB')))
    assert.deepEqual([other.ok, other.reason, other.orderId], [false, 'already_reserved', 'ORDERA'])
  })

  await t.test('commande expirée : libération, nouvelle commande ; un onglet en retard ne libère plus rien', () => {
    assert.equal(json(psql(database, release('ORDERA'))).ok, true)
    assert.equal(psql(database, `select status||'|'||paypal_order_id from public.conference_passes where id = '${ids.pass}'`), 'released|ORDERA', 'la commande reste connue après libération')
    assert.equal(json(psql(database, reserve('hash-one', 'ORDERB'))).ok, true)
    assert.deepEqual(json(psql(database, release('ORDERA'))), { ok: false, reason: 'pass_not_found' }, 'onglet en retard : rien n’est libéré')
    assert.equal(psql(database, `select count(*) from public.conference_pass_events where pass_id = '${ids.pass}' and event_name = 'checkout_started'`), '2', 'un événement daté par nouvelle commande (garde-fou d’ancienneté)')
  })

  await t.test('trace d’encaissement acceptée par la contrainte et retrouvable par commande', () => {
    psql(database, `insert into public.conference_pass_events (event_id, pass_id, registration_id, event_name, metadata)
      select event_id, id, registration_id, 'payment_completed', '{"stage":"captured","orderId":"ORDERB","captureId":"CAP1"}' from public.conference_passes where id = '${ids.pass}'`)
    assert.equal(psql(database, `select count(*) from public.conference_pass_events where pass_id = '${ids.pass}' and event_name = 'payment_completed' and metadata->>'orderId' = 'ORDERB'`), '1')
  })

  await t.test('Pass payé : jamais libéré, jamais réservé pour une autre commande', () => {
    psql(database, `update public.conference_passes set paypal_capture_id = 'CAP1', redeemed_at = now(), status = 'redeemed' where id = '${ids.pass}'`)
    assert.equal(json(psql(database, release('ORDERB'))).reason, 'captured_payment_requires_reconciliation')
    assert.equal(json(psql(database, reserve('hash-one', 'ORDERC'))).ok, false)
  })

  await t.test('Sandbox : la base impose 1 € (un test 4X à 499 € exigerait une migration)', () => {
    addPass('hash-two', ids.pass)
    assert.equal(json(psql(database, reserve('hash-two', 'ORDERS', 'sandbox', 49900))).reason, 'amount_mismatch')
    assert.equal(json(psql(database, reserve('hash-two', 'ORDERL', 'live', 49900))).ok, true, 'Live : 499 € accepté')
  })

  await t.test('deux onglets simultanés : verrou de ligne, une seule commande retenue', async () => {
    addPass('hash-three', ids.pass)
    // Onglet 1 réserve N1 et garde le verrou ; l'onglet 2 tente N2 pendant ce temps.
    const first = psqlAsync(database, `begin; ${reserve('hash-three', 'ORDERN1')}; select pg_sleep(1.2); commit;`)
    await new Promise((r) => setTimeout(r, 300))
    const second = psqlAsync(database, reserve('hash-three', 'ORDERN2'))
    const [a, b] = await Promise.all([first, second])
    assert.equal(json(a.out).ok, true)
    const late = json(b.out)
    assert.deepEqual([late.ok, late.reason, late.orderId], [false, 'already_reserved', 'ORDERN1'], 'le second onglet attend le verrou puis voit la commande du premier')
    assert.ok(b.at >= a.at - 50, 'le second onglet a bien attendu la fin du premier')
    // Même commande (même clé d'idempotence PayPal) depuis deux onglets : un seul événement.
    psql(database, release('ORDERN1'))
    const [x, y] = await Promise.all([psqlAsync(database, reserve('hash-three', 'ORDERN3')), psqlAsync(database, reserve('hash-three', 'ORDERN3'))])
    assert.deepEqual([json(x.out).ok, json(y.out).ok], [true, true])
    assert.equal(psql(database, `select paypal_order_id from public.conference_passes where token_hash = 'hash-three'`), 'ORDERN3')
  })
})
