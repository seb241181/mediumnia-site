import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('public routes receive dedicated client-side metadata and canonical URLs', () => {
  const app = read('src/App.jsx')
  assert.match(app, /Formation à la médiumnité consciente — MediumIA/)
  assert.match(app, /Chronosphère 999 — Oracle des Lignes de Temps \| MediumIA/)
  assert.match(app, /Réseau MediumIA — Trouver un praticien/)
  assert.match(app, /Conférences MediumIA — Rencontres et directs/)
  assert.match(app, /reseauPractitioners\.find/)
  assert.match(app, /canonical\.setAttribute\('href', canonicalUrl\)/)
  assert.match(app, /applyRouteMeta\(view\)/)
})

test('private appointment administration routes are noindex', () => {
  const app = read('src/App.jsx')
  assert.match(app, /view === 'rdv-dashboard' \|\| view === 'rdv-cancellation'/)
  assert.match(app, /noindex,follow/)
})

test('Chronosphere explains exact birth time, number choice and pack resume before payment', () => {
  const chrono = read('src/components/ChronospherePage.jsx')
  assert.match(chrono, /aucune heure approximative n’est inventée/)
  assert.match(chrono, /vérifiez votre acte de naissance/)
  assert.match(chrono, /trois nombres différents entre 1 et 58/)
  assert.match(chrono, /Le premier porte l’axe principal du tirage/)
  assert.match(chrono, /l’e-mail contient votre lien personnel pour reprendre les tirages restants/)
})

test('mobile footer links expose comfortable touch targets', () => {
  const footer = read('src/components/LegalFooter.jsx')
  assert.match(footer, /min-h-11/)
  assert.match(footer, /text-xs/)
  assert.match(footer, /gap-x-1/)
})
