import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  claimInvitation,
  cleanAssistantFields,
  getWorkspaceState,
  inviteProMember,
  revokeProInvitation,
  saveAssistant,
} from '../lib/proWorkspace.js'
import { buildAssistantDraft } from '../src/lib/proAssistantDraft.js'
import { reseauPractitioners } from '../src/data/reseauPractitioners.js'

// Faux client Supabase en mémoire : filtres eq/neq/in, insert/update, single.
function fakeDb({ users = {}, tables = {} } = {}) {
  const data = { pro_memberships: [], pro_invitations: [], agents: [], ...structuredClone(tables) }
  let seq = 0
  const db = {
    data,
    auth: { admin: { getUserById: async (id) => ({ data: { user: users[id] || null }, error: users[id] ? null : { message: 'nope' } }) } },
    async rpc(name, args = {}) {
      if (name !== 'claim_mediumia_pro_invitation') return { data: null, error: { message: 'unknown rpc' } }

      const membership = data.pro_memberships.find((m) => m.user_id === args.p_user_id)
      if (membership?.status === 'active' && (!membership.expires_at || new Date(membership.expires_at) > new Date())) {
        return { data: [{ result: 'already_active', invitation_reseau_slug: null }], error: null }
      }
      if (membership && membership.status !== 'invited') {
        return { data: [{ result: 'membership_locked', invitation_reseau_slug: null }], error: null }
      }

      const email = String(args.p_email_normalized || '').trim().toLowerCase()
      const invitation = data.pro_invitations.find((i) => String(i.email || '').trim().toLowerCase() === email && i.status === 'pending')
      if (!invitation) return { data: [{ result: 'invitation_not_found', invitation_reseau_slug: null }], error: null }

      if (membership) {
        Object.assign(membership, { status: 'active', access_level: 'pro', activated_at: new Date().toISOString() })
      } else {
        data.pro_memberships.push({
          id: `id-${++seq}`,
          user_id: args.p_user_id,
          access_level: 'pro',
          status: 'active',
          activated_at: new Date().toISOString(),
        })
      }
      Object.assign(invitation, {
        status: 'accepted',
        accepted_user_id: args.p_user_id,
        accepted_at: new Date().toISOString(),
      })
      return { data: [{ result: 'activated', invitation_reseau_slug: invitation.reseau_slug || null }], error: null }
    },
    from(table) {
      const q = { table, filters: [], op: 'select', values: null, limit: null, single: false }
      const rows = () => data[table].filter((r) => q.filters.every(([k, op, v]) => {
        const val = k === 'email_normalized' ? String(r.email || '').trim().toLowerCase() : r[k]
        return op === 'eq' ? val === v : op === 'neq' ? val !== v : v.includes(val)
      }))
      const b = {
        select() { return b }, order() { return b },
        eq(k, v) { q.filters.push([k, 'eq', v]); return b },
        neq(k, v) { q.filters.push([k, 'neq', v]); return b },
        in(k, v) { q.filters.push([k, 'in', v]); return b },
        limit(n) { q.limit = n; return b },
        maybeSingle() { q.single = 'maybe'; return b },
        single() { q.single = true; return b },
        insert(v) { q.op = 'insert'; q.values = v; return b },
        update(v) { q.op = 'update'; q.values = v; return b },
        then(resolve, reject) {
          let result
          if (q.op === 'insert') {
            // Comme la vraie table : une invitation est « pending » par défaut.
            const defaults = table === 'pro_invitations' ? { status: 'pending' } : {}
            const row = { id: `id-${++seq}`, created_at: new Date().toISOString(), ...defaults, ...q.values }
            if (table === 'agents' && row.reseau_slug && data.agents.some((a) => a.reseau_slug === row.reseau_slug && a.status !== 'archived')) {
              result = { data: null, error: { code: '23505' } }
            } else {
              data[table].push(row)
              result = { data: q.single ? row : [row], error: null }
            }
          } else if (q.op === 'update') {
            const hit = rows()
            hit.forEach((r) => Object.assign(r, q.values))
            result = { data: q.single ? hit[0] : hit, error: null }
          } else {
            let hit = rows()
            if (q.limit) hit = hit.slice(0, q.limit)
            result = { data: q.single ? (hit[0] || null) : hit, error: null }
          }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return b
    },
  }
  return db
}

const confirmed = { email: 'Claire@Example.fr', email_confirmed_at: '2026-09-27T10:00:00Z' }

test('an account alone grants nothing: invitation and confirmed e-mail are both required', async () => {
  const db = fakeDb({ users: { u1: { email: 'claire@example.fr', email_confirmed_at: null } } })
  const noInvite = await claimInvitation({ db, userId: 'u1' })
  assert.equal(noInvite.status, 403)
  db.data.pro_invitations.push({ id: 'i1', email: 'claire@example.fr', status: 'pending', reseau_slug: 'amandine-pouwels' })
  const unconfirmed = await claimInvitation({ db, userId: 'u1' })
  assert.deepEqual(unconfirmed.body, { error: 'email_not_confirmed' })
  assert.equal(db.data.pro_memberships.length, 0)
})

test('a confirmed invited professional activates a pro membership once', async () => {
  const db = fakeDb({ users: { u1: confirmed }, tables: { pro_invitations: [{ id: 'i1', email: 'claire@example.fr', status: 'pending', reseau_slug: 'amandine-pouwels' }] } })
  const state = await getWorkspaceState({ db, userId: 'u1' })
  assert.equal(state.body.membership, null)
  assert.deepEqual(state.body.invitation, { reseauSlug: 'amandine-pouwels' })

  const res = await claimInvitation({ db, userId: 'u1' })
  assert.equal(res.status, 200)
  assert.equal(db.data.pro_memberships[0].access_level, 'pro')
  assert.equal(db.data.pro_memberships[0].status, 'active')
  assert.equal(db.data.pro_invitations[0].status, 'accepted')
  assert.equal(db.data.pro_invitations[0].accepted_user_id, 'u1')

  const again = await claimInvitation({ db, userId: 'u1' })
  assert.equal(again.body.alreadyActive, true)
  assert.equal(db.data.pro_memberships.length, 1)
})

test('a suspended or revoked membership never reactivates itself', async () => {
  const db = fakeDb({ users: { u1: confirmed }, tables: {
    pro_memberships: [{ id: 'm1', user_id: 'u1', access_level: 'pro', status: 'suspended' }],
    pro_invitations: [{ id: 'i2', email: 'claire@example.fr', status: 'pending' }],
  } })
  const res = await claimInvitation({ db, userId: 'u1' })
  assert.deepEqual(res.body, { error: 'membership_locked' })
  assert.equal(db.data.pro_memberships[0].status, 'suspended')
})

test('the assistant is created by the server, linked to the invited fiche, private by default', async () => {
  const db = fakeDb({ tables: {
    pro_memberships: [{ id: 'm1', user_id: 'u1', access_level: 'pro', status: 'active' }],
    pro_invitations: [{ id: 'i1', email: 'claire@example.fr', status: 'accepted', accepted_user_id: 'u1', reseau_slug: 'amandine-pouwels' }],
  } })
  const draft = buildAssistantDraft(reseauPractitioners.find((p) => p.id === 'amandine-pouwels'))
  const res = await saveAssistant({ db, userId: 'u1', input: { ...draft, provider: 'openai', public_enabled: true, reseau_slug: 'gilda' } })
  assert.equal(res.status, 201)
  const agent = db.data.agents[0]
  assert.equal(agent.provider, 'anthropic')
  assert.equal(agent.public_enabled, false)
  assert.equal(agent.reseau_slug, 'amandine-pouwels')
  assert.equal(agent.membership_id, 'm1')
  assert.match(agent.knowledge_summary, /Deuil/)

  const edit = await saveAssistant({ db, userId: 'u1', input: { ...draft, name: 'Assistant Amandine' } })
  assert.equal(edit.status, 200)
  assert.equal(db.data.agents.length, 1)
  assert.equal(db.data.agents[0].name, 'Assistant Amandine')
})

test('no membership, no assistant; empty or oversized answers are refused', async () => {
  const db = fakeDb()
  assert.equal((await saveAssistant({ db, userId: 'u9', input: { name: 'X', mission: 'Une mission claire' } })).status, 403)
  const { errors } = cleanAssistantFields({ name: 'A', mission: '', knowledge_summary: 'x'.repeat(7000) })
  assert.deepEqual(errors.sort(), ['knowledge_summary_too_long', 'mission_required', 'name_required'])
})

test('admin invitations: validated e-mail and fiche, e-mail sent, revocation suspends only a pro access', async () => {
  const sent = []
  const db = fakeDb({ tables: {
    pro_memberships: [{ id: 'm1', user_id: 'u1', access_level: 'pro', status: 'active' }, { id: 'm0', user_id: 'founder', access_level: 'founder', status: 'active' }],
  } })
  assert.equal((await inviteProMember({ db, userId: 'admin', input: { email: 'pas-un-email' } })).status, 400)
  assert.equal((await inviteProMember({ db, userId: 'admin', input: { email: 'a@b.fr', reseauSlug: 'inconnu' } })).status, 400)
  const ok = await inviteProMember({ db, userId: 'admin', input: { email: 'Gilda@Exemple.fr', reseauSlug: 'gilda' }, send: async (m) => { sent.push(m); return { status: 'sent' } } })
  assert.equal(ok.status, 201)
  assert.equal(ok.body.emailStatus, 'sent')
  assert.equal(sent[0].to, 'gilda@exemple.fr')
  assert.match(sent[0].text, /mediumia\.fr\/agents/)

  const duplicateProfile = await inviteProMember({
    db,
    userId: 'admin',
    input: { email: 'autre@exemple.fr', reseauSlug: 'gilda' },
    send: async () => ({ status: 'sent' }),
  })
  assert.equal(duplicateProfile.status, 409)
  assert.equal(duplicateProfile.body.error, 'reseau_profile_already_invited')

  db.data.pro_invitations.push({ id: '00000000-0000-4000-8000-000000000001', email: 'x@y.fr', status: 'accepted', accepted_user_id: 'u1' })
  const revoked = await revokeProInvitation({ db, input: { id: '00000000-0000-4000-8000-000000000001' } })
  assert.equal(revoked.status, 200)
  assert.equal(db.data.pro_memberships.find((m) => m.id === 'm1').status, 'suspended')
  assert.equal(db.data.pro_memberships.find((m) => m.id === 'm0').status, 'active')
})


test('the Pro invitation migration keeps claiming atomic and one live invitation per Network profile', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260927150000_mediumia_pro_reseau_invitations.sql', import.meta.url), 'utf8')
  assert.match(migration, /create unique index if not exists pro_invitations_one_live_per_reseau_slug_idx/)
  assert.match(migration, /create or replace function public\.claim_mediumia_pro_invitation/)
  assert.match(migration, /security definer/)
  assert.match(migration, /revoke all on function public\.claim_mediumia_pro_invitation\(uuid, text\)[\s\S]*authenticated/)
  assert.match(migration, /grant execute on function public\.claim_mediumia_pro_invitation\(uuid, text\)[\s\S]*service_role/)
})

// Un corps de fonction délimité par « $ » au lieu de « $$ » fait échouer tout
// le script dans Supabase (syntax error at or near "$"), constaté le 27/09.
test('every PL/pgSQL body in the Pro invitation migration uses valid dollar quoting', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260927150000_mediumia_pro_reseau_invitations.sql', import.meta.url), 'utf8')
  const openers = migration.match(/^as \$[A-Za-z_]*\$$/gm) || []
  const closers = migration.match(/^\$[A-Za-z_]*\$;$/gm) || []
  assert.equal(openers.length, 1)
  assert.equal(closers.length, 1)
  assert.doesNotMatch(migration, /^as \$\s*$/m)
  assert.doesNotMatch(migration, /^\$;\s*$/m)
})
