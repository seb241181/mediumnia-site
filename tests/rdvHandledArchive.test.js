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

test('une demande déjà traitée disparaît de la file et reste accessible en archives', () => {
  const ui = read('src/components/rdv/RdvDashboard.jsx')
  assert.match(ui, /const CLOSED_REQUEST_STATUSES = \['handled', 'rejected', 'cancelled'\]/)
  assert.match(ui, /const archivedRequests = .*CLOSED_REQUEST_STATUSES\.includes\(request\.status\)/)
  assert.match(ui, /const visibleRequests = .*\!CLOSED_REQUEST_STATUSES\.includes\(request\.status\)/)
  assert.match(ui, /visibleRequests\.map\(req =>/)
  assert.match(ui, /updateStatus\(req, 'handled'\)/)
  assert.match(ui, /Déjà traité/)
  assert.match(ui, /Archives · Demandes clôturées/)
  assert.match(ui, /updateStatus\(req, 'pending'\)/)
  assert.match(ui, /Remettre à traiter/)
  assert.match(ui, /selectedArchivableRequests/)
  assert.match(ui, /window\.confirm/)
  assert.match(ui, /selectedRequestIds/)
  assert.match(ui, /status: 'handled'/)
  assert.match(ui, /req\.status === 'handled'/)
})

test('rendez-vous soldés seulement si confirmés, total connu et reste nul', () => {
  const ui = read('src/components/rdv/DailyPayments.jsx')
  assert.match(ui, /const isFullySettled =/)
  assert.match(ui, /booking\.status === 'confirmed'/)
  assert.match(ui, /booking\.total_cents > 0/)
  assert.match(ui, /booking\.remaining_cents === 0/)
  assert.match(ui, /const settledBookings = .*filter\(isFullySettled\)/)
  assert.match(ui, /const outstandingBookings = .*\!isFullySettled\(booking\)/)
  assert.match(ui, /Rendez-vous intégralement réglés/)
  assert.match(ui, /data\.remaining_cents > 0/)
  assert.match(ui, /collected\.totals\.gross_cents/)
})
