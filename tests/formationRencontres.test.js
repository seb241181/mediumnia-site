import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { RENCONTRES_CYCLE_1, rencontreRights, rencontreAvailability } from '../lib/formationRencontres.js'
import { handleFormationRencontres } from '../lib/formationRencontresApi.js'
import { MEDIUMIA_PUBLIC_CATALOG } from '../lib/mediumiaPublicCatalog.js'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = () => read('src/components/FormationPage.jsx')
const section = () => {
  const source = page()
  const start = source.indexOf('<section id="rencontres"')
  return source.slice(start, source.indexOf('</section>', start))
}
const paris = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

test('rencontres : cinq samedis du premier cycle 2027, de 10 h à 12 h heure de Paris (hiver et été)', () => {
  assert.deepEqual(RENCONTRES_CYCLE_1.map((r) => [r.label, r.theme]), [
    ['Samedi 16 janvier 2027', 'Premiers apprentissages'],
    ['Samedi 13 février 2027', 'Perceptions et discernement'],
    ['Samedi 13 mars 2027', 'Pratique et techniques'],
    ['Samedi 10 avril 2027', 'Approfondissement'],
    ['Samedi 22 mai 2027', 'Intégration et autonomie'],
  ])
  for (const r of RENCONTRES_CYCLE_1) {
    assert.equal(paris(r.startsAt), 'samedi 10:00', r.id)
    assert.equal(paris(r.endsAt), 'samedi 12:00', r.id)
    assert.equal(r.startsAt.slice(0, 10), r.id)
  }
})

test('page : le bloc utilise les dates partagées, sans lien de visio ni inscription', () => {
  const source = page()
  assert.match(source, /import \{ RENCONTRES_CYCLE_1 \} from '\.\.\/\.\.\/lib\/formationRencontres\.js'/)
  assert.match(section(), /<time dateTime=\{r\.startsAt\}/)
  assert.match(section(), /Le samedi, de 10 h à 12 h \(heure de Paris\)/)
  assert.match(section(), /sans supplément pour les élèves de la formation complète \(597 €\), réglée en une fois ou au terme du parcours progressif\. La Découverte à 29 € seule n'y donne pas accès\./)
  assert.match(section(), /Réservations : ouverture prochainement/)
  assert.match(source, /Les réservations ouvriront prochainement, depuis votre espace élève\. Chaque rencontre se déroule en petit groupe : 5 places au lancement\./)
  assert.match(source, /Si vous n'êtes pas encore prêt pour un thème, vous le retrouverez lors d'une prochaine programmation/)
  assert.doesNotMatch(source, /zoom\.us|meet\.google|teams\.microsoft/i)
  assert.doesNotMatch(section(), /<button|<a |href=|onClick|FormationCheckout|modules? \d/i)
})

test('page : les deux paiements restent en place et le menu pointe vers le bloc', () => {
  const source = page()
  assert.equal((source.match(/<FormationCheckout product="discovery" \/>/g) || []).length, 1)
  assert.equal((source.match(/<FormationCheckout \/>/g) || []).length, 1)
  assert.match(source, /\{ id: 'rencontres', label: 'Visios 2027' \}/)
  assert.match(source, /q: 'Les rencontres en visio sont-elles comprises dans la formation \?'/)
})


const [janvier, , mars, , mai] = RENCONTRES_CYCLE_1
const full = (startedAt, extra = {}) => ({ type: 'purchase', status: 'active', access_level: 'full', max_module: 25, access_started_at: startedAt, ...extra })

test('droits : 18 mois après l’ouverture de l’accès complet, indépendants des 12 mois d’application', () => {
  assert.deepEqual(rencontreRights([full('2026-09-02T08:00:00Z')]), { eligible: true, reason: null, from: '2026-09-02T08:00:00.000Z', until: '2028-03-02T08:00:00.000Z' })
  assert.equal(rencontreRights([full('2027-03-01T08:00:00Z'), full('2026-12-01T08:00:00Z', { type: 'admin' })]).from, '2026-12-01T08:00:00.000Z')
})

test('droits : un ancien acheteur couvre au minimum tout le premier cycle', () => {
  const r = rencontreRights([full('2025-01-01T08:00:00Z')])
  assert.equal(r.until, new Date(mai.endsAt).toISOString())
  assert.ok(new Date(mai.startsAt) <= new Date(r.until))
})

test('droits : Découverte seule, parcours en cours, accès révoqué ou essai = pas de rencontre', () => {
  assert.equal(rencontreRights([]).reason, 'formation_incomplete')
  assert.equal(rencontreRights([full('2026-10-05T08:00:00Z', { access_level: 'discovery', max_module: 1 })]).eligible, false)
  assert.equal(rencontreRights([full('2026-10-05T08:00:00Z', { max_module: 13 })]).eligible, false)
  assert.equal(rencontreRights([full('2026-10-05T08:00:00Z', { status: 'revoked' })]).eligible, false)
  assert.equal(rencontreRights([full('2026-10-05T08:00:00Z', { type: 'trial' })]).eligible, false)
})

const session = (over = {}) => ({ status: 'scheduled', bookings_open: true, capacity: 5, starts_at: janvier.startsAt, ...over })
const rightsOk = { eligible: true, from: '2026-09-02T08:00:00.000Z', until: '2028-03-02T08:00:00.000Z' }
const now = new Date('2026-12-01T09:00:00Z')

test('disponibilité : ouverte, complète, fermée, thème utilisé, hors droits, passée, non éligible', () => {
  const at = (over, extra = {}) => rencontreAvailability({ rights: rightsOk, rencontre: session(over), bookedCount: 0, now, ...extra }).state
  assert.deepEqual(rencontreAvailability({ rights: rightsOk, rencontre: session(), bookedCount: 3, now }), { state: 'open', placesLeft: 2 })
  assert.equal(at({}, { bookedCount: 5 }), 'full')
  assert.equal(at({ bookings_open: false }), 'closed')
  assert.equal(at({}, { themeUsed: true }), 'theme_used')
  assert.equal(at({}, { rights: { eligible: true, from: '2026-09-02T08:00:00Z', until: '2026-12-31T00:00:00Z' } }), 'outside_rights')
  assert.equal(at({}, { now: new Date('2027-01-16T09:30:00Z') }), 'past')
  assert.equal(at({}, { rights: { eligible: false } }), 'not_eligible')
  assert.equal(at({ status: 'cancelled' }), 'cancelled')
})

test('disponibilité : une place réservée s’annule jusqu’à 24 h avant, pas après', () => {
  const booked = { status: 'booked' }
  assert.deepEqual(rencontreAvailability({ rights: rightsOk, rencontre: session(), myBooking: booked, now: new Date('2027-01-15T09:00:00Z') }), { state: 'booked', canCancel: true })
  assert.deepEqual(rencontreAvailability({ rights: rightsOk, rencontre: session(), myBooking: booked, now: new Date('2027-01-15T09:30:00Z') }), { state: 'booked', canCancel: false })
})

// Base simulée : seules les opérations utilisées par le serveur.
function fakeSupabase({ users = {}, tables = {}, owners = [] } = {}) {
  const rpcCalls = []
  const query = (table) => {
    const filters = []
    const builder = {
      select: () => builder,
      eq: (c, v) => (filters.push((r) => r[c] === v), builder),
      in: (c, v) => (filters.push((r) => v.includes(r[c])), builder),
      gte: (c, v) => (filters.push((r) => r[c] >= v), builder),
      order: () => builder,
      limit: () => builder,
      then: (resolve) => {
        if (table === 'booking_practitioners') return resolve({ data: owners.filter((o) => filters.every((f) => f(o))), error: null })
        return resolve({ data: (tables[table] || []).filter((r) => filters.every((f) => f(r))), error: null })
      },
    }
    return builder
  }
  return {
    rpcCalls,
    from: query,
    rpc: async (fn, args) => (rpcCalls.push({ fn, args }), { data: { ok: true, places_left: 4 }, error: null }),
    auth: {
      getUser: async (token) => (users[token] ? { data: { user: { id: users[token] } }, error: null } : { data: null, error: new Error('bad') }),
      admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@test.local` } } }) },
    },
  }
}
const response = () => {
  const res = { headers: {}, statusCode: 0, body: null }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  return res
}
const call = async (supabase, action, { method = 'GET', token, body } = {}) => {
  const res = response()
  await handleFormationRencontres({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res, action, { supabase, now })
  return res
}
const SID = '11111111-1111-4111-8111-111111111111'
const sessions = RENCONTRES_CYCLE_1.map((r, i) => ({ id: `${SID.slice(0, -1)}${i}`, theme_key: r.themeKey, title: r.theme, starts_at: new Date(r.startsAt).toISOString(), ends_at: new Date(r.endsAt).toISOString(), capacity: 5, bookings_open: false, status: 'scheduled' }))
const db = () => fakeSupabase({
  users: { eleve: 'u-eleve', decouverte: 'u-decouverte', owner: 'u-owner' },
  owners: [{ owner_id: 'u-owner', slug: 'sebastien-seguin', id: 'p1' }],
  tables: {
    formation_rencontres: sessions,
    formation_rencontre_bookings: [{ id: 'b1', rencontre_id: sessions[0].id, user_id: 'u-eleve', theme_key: sessions[0].theme_key, status: 'booked', created_at: '2026-11-30T10:00:00Z' }],
    mediumia_entitlements: [
      { user_id: 'u-eleve', ...full('2026-09-02T08:00:00Z') },
      { user_id: 'u-decouverte', ...full('2026-10-05T08:00:00Z', { access_level: 'discovery', max_module: 1 }) },
    ],
  },
})

test('serveur : connexion obligatoire, bonne méthode HTTP, action connue', async () => {
  const supabase = db()
  assert.equal((await call(supabase, 'mine')).statusCode, 401)
  assert.equal((await call(supabase, 'book', { token: 'eleve' })).statusCode, 405)
  assert.equal((await call(supabase, 'nope', { token: 'eleve' })).statusCode, 404)
})

test('serveur : l’élève voit ses cinq rencontres, sa réservation et ses droits', async () => {
  const res = await call(db(), 'mine', { token: 'eleve' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['Cache-Control'], 'no-store')
  assert.deepEqual(res.body.rights, { eligible: true, until: '2028-03-02T08:00:00.000Z' })
  assert.deepEqual(res.body.sessions.map((s) => s.state), ['booked', 'closed', 'closed', 'closed', 'closed'])
  assert.equal(res.body.sessions[0].bookingId, 'b1')
  assert.equal(res.body.sessions[0].placesLeft, 4)
})

test('serveur : la Découverte seule ne peut pas réserver, et la base n’est pas appelée', async () => {
  const supabase = db()
  const mine = await call(supabase, 'mine', { token: 'decouverte' })
  assert.equal(mine.body.rights.eligible, false)
  assert.ok(mine.body.sessions.every((s) => s.state === 'not_eligible'))
  const book = await call(supabase, 'book', { method: 'POST', token: 'decouverte', body: { rencontreId: sessions[1].id } })
  assert.deepEqual([book.statusCode, book.body.error], [403, 'not_eligible'])
  assert.equal(supabase.rpcCalls.length, 0)
})

test('serveur : la réservation transmet les droits recalculés, jamais ceux du navigateur', async () => {
  const supabase = db()
  assert.equal((await call(supabase, 'book', { method: 'POST', token: 'eleve', body: { rencontreId: 'x' } })).statusCode, 400)
  const res = await call(supabase, 'book', { method: 'POST', token: 'eleve', body: { rencontreId: sessions[1].id, rightsUntil: '2099-01-01' } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(supabase.rpcCalls, [{ fn: 'formation_rencontre_book', args: { p_user_id: 'u-eleve', p_rencontre_id: sessions[1].id, p_rights_from: '2026-09-02T08:00:00.000Z', p_rights_until: '2028-03-02T08:00:00.000Z' } }])
})

test('serveur : administration réservée au propriétaire, avec inscrits et validations', async () => {
  const supabase = db()
  assert.equal((await call(supabase, 'admin', { token: 'eleve' })).statusCode, 403)
  const admin = await call(supabase, 'admin', { token: 'owner' })
  assert.equal(admin.statusCode, 200)
  assert.deepEqual(admin.body.sessions[0].participants, [{ bookingId: 'b1', email: 'u-eleve@test.local', status: 'booked', bookedAt: '2026-11-30T10:00:00Z' }])
  assert.equal((await call(supabase, 'admin-update', { method: 'POST', token: 'owner', body: { rencontreId: sessions[0].id, capacity: 0 } })).statusCode, 400)
  assert.equal((await call(supabase, 'admin-mark', { method: 'POST', token: 'owner', body: { bookingId: '22222222-2222-4222-8222-222222222222', status: 'deleted' } })).statusCode, 400)
  const ok = await call(supabase, 'admin-update', { method: 'POST', token: 'owner', body: { rencontreId: sessions[0].id, capacity: 6, bookingsOpen: true } })
  assert.equal(ok.statusCode, 200)
  assert.deepEqual(supabase.rpcCalls.at(-1), { fn: 'formation_rencontre_admin_update', args: { p_rencontre_id: sessions[0].id, p_capacity: 6, p_bookings_open: true } })
})

test('migration : capacité verrouillée, un thème par élève, annulation à 24 h, fonctions réservées au serveur', () => {
  const sql = read('supabase/migrations/20261022120000_formation_rencontres.sql')
  assert.match(sql, /from public\.formation_rencontres where id = p_rencontre_id for update;/)
  assert.match(sql, /if v_booked >= r\.capacity then return jsonb_build_object\('ok', false, 'reason', 'full'\)/)
  assert.match(sql, /if r\.starts_at <= now\(\) then return jsonb_build_object\('ok', false, 'reason', 'started'\)/)
  assert.match(sql, /on public\.formation_rencontre_bookings \(user_id, theme_key\)\n  where status in \('booked', 'attended', 'absent'\)/)
  assert.match(sql, /if v_starts - now\(\) < interval '24 hours'/)
  assert.match(sql, /capacity integer not null default 5/)
  for (const fn of ['formation_rencontre_book', 'formation_rencontre_cancel', 'formation_rencontre_admin_update', 'formation_rencontre_admin_mark']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`))
  }
  assert.equal((sql.match(/bookings_open boolean not null default false/g) || []).length, 1)
})

test('assistant : le catalogue annonce les cinq dates sans ouvrir de réservation', () => {
  for (const r of RENCONTRES_CYCLE_1) assert.ok(MEDIUMIA_PUBLIC_CATALOG.includes(`${r.label} (${r.theme.toLowerCase()})`), r.id)
  assert.match(MEDIUMIA_PUBLIC_CATALOG, /Les réservations ne sont PAS encore ouvertes : elles ouvriront prochainement/)
  assert.match(MEDIUMIA_PUBLIC_CATALOG, /La formule Découverte à 29 € seule ne donne pas accès aux rencontres/)
  assert.match(MEDIUMIA_PUBLIC_CATALOG, /ceux dont les paiements atteignent 597 €, en une fois ou par le parcours progressif/)
  assert.doesNotMatch(MEDIUMIA_PUBLIC_CATALOG, /zoom\.us|meet\.google|teams\.microsoft|modules? 1 ?[-–à]/i)
})
