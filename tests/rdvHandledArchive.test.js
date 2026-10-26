import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('demande déjà traitée reste archivée, réversible, sans supprimer le contenu', () => {
  const sql = read('supabase/migrations/20261016181000_booking_requests_handled_archive.sql')
  assert.match(sql, /ADD CONSTRAINT booking_requests_status_check/)
  assert.match(sql, /'handled'::text/)
  assert.doesNotMatch(sql, /DELETE FROM|TRUNCATE TABLE|DROP TABLE|UPDATE public\.booking_requests/i)

  const admin = read('api/rdv-admin.js')
  assert.match(admin, /\.in\('status', \['pending', 'contacted', 'scheduled', 'handled'\]\)/)
  assert.match(admin, /'cancelled', 'handled'/)
  assert.match(admin, /const archiveAllowed = status === 'handled'/)
  assert.match(admin, /\['pending', 'contacted'\]\.includes\(request\.status\)/)
  assert.match(admin, /const reopenAllowed = status === 'pending'/)
  assert.match(admin, /request\.status === 'handled'/)
  assert.match(admin, /!request\.confirmed_booking_id/)
  const special = admin.split("if (status === 'handled' || request.status === 'handled')")[1]
    ?.split('// ── operation=sync_google')[0]
  assert.ok(special)
  assert.match(special, /\.eq\('status', request\.status\)/)
  assert.match(special, /\.is\('confirmed_booking_id', null\)/)
  assert.match(special, /return res\.status\(200\)\.json\(\{ request: changed \}\)/)
  assert.doesNotMatch(special, /syncBookingToGoogleCalendar|sendEmail\(|confirm_booking_request|sendEmailConfirmation|payment/i)
})

test('les nouvelles demandes restent visibles et celles déjà traitées sont regroupées à part', () => {
  const ui = read('src/components/rdv/RdvDashboard.jsx')
  assert.match(ui, /const visibleRequests = .*request\.status === 'pending'/)
  assert.match(ui, /const followUpRequests = .*request\.status === 'contacted'/)
  assert.match(ui, /const archivedRequests = .*'handled', 'scheduled'/)
  assert.match(ui, /visibleRequests\.map\(renderRequestCard\)/)
  assert.match(ui, /followUpRequests\.map\(renderRequestCard\)/)
  assert.match(ui, /À suivre · Déjà contactées/)
  assert.match(ui, /Archives · Dossiers traités/)
  assert.match(ui, /updateStatus\(req, 'handled'\)/)
  assert.match(ui, /updateStatus\(req, 'pending'\)/)
  assert.match(ui, /Remettre à traiter/)
  assert.match(ui, /const canConfirm = req.status === 'pending' \|\| req.status === 'contacted'/)
  assert.match(ui, /req.status === 'scheduled' && !req.google_event_id/)
})

test('cartes de demandes : affichage mobile vertical, actions non chevauchées et bureau conservé', () => {
  const ui = read('src/components/rdv/RdvDashboard.jsx')
  assert.match(ui, /flex flex-col items-stretch gap-3 px-4 py-4 cursor-pointer[^"]*xl:flex-row/)
  assert.match(ui, /w-full min-w-0 flex-wrap items-center gap-2 xl:w-auto/)
  assert.match(ui, /min-h-10 shrink-0 whitespace-nowrap[^"]*Déjà traité|className="min-h-10 shrink-0 whitespace-nowrap/)
  assert.match(ui, /leading-snug text-deep \[overflow-wrap:anywhere\]/)
  assert.match(ui, /grid grid-cols-1 sm:grid-cols-2 gap-x-4/)
  assert.match(ui, /flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between mb-4/)
  assert.match(ui, /updateStatus\(req, 'handled'\)/)
  assert.match(ui, /onClick=\{\(event\) => \{\s*event.stopPropagation\(\)/)
})
