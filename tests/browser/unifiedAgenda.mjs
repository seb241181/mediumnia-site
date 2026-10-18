import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
const { chromium } = createRequire(import.meta.url)('playwright')
const base = process.env.AGENDA_TEST_URL || 'http://127.0.0.1:4193'
const output = new URL('../../docs/agenda-captures/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
let checks = 0
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1050 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, timezoneId: 'America/New_York' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    let requests = 0
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.origin !== new URL(base).origin) return route.abort()
      if (url.pathname === '/api/rdv-admin') {
        assert.equal(route.request().method(), 'GET')
        assert.equal(url.searchParams.get('action'), 'agenda')
        requests++
        const from = url.searchParams.get('from'), to = url.searchParams.get('to')
        const now = new Date()
        now.setUTCHours(9, 0, 0, 0)
        const end = new Date(now.getTime() + 3600000)
        const record = { id: 'booking:fictional', source: 'mediumia', title: 'Camille TEST', start: now.toISOString(), end: end.toISOString(), status: 'confirmed', payment: { total_cents: 5000, paid_cents: 2000, remaining_cents: 3000 }, permissions: { move: false, cancel: false, refund: false } }
        return route.fulfill({ json: { start: from, end: to, sources: { google: 'ready', finance: 'ready', mediumia: 'ready' }, events: [record, { ...record, id: 'google:fictional', title: 'Créneau Google TEST', source: 'google', start: new Date(now.getTime() + 7200000).toISOString(), end: new Date(end.getTime() + 7200000).toISOString(), payment: null }] } })
      }
      return route.continue()
    })
    await page.goto(`${base}/tests/fixtures/unified-agenda-preview.html`)
    await page.getByRole('button', { name: 'Mois', exact: true }).click()
    await page.getByRole('button', { name: /Camille TEST/ }).first().waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    checks++
    await page.getByRole('button', { name: /Camille TEST/ }).first().click()
    await page.getByRole('heading', { name: 'Camille TEST' }).waitFor()
    assert.match(await page.getByRole('complementary').innerText(), /30,00/)
    assert.match(await page.getByRole('complementary').innerText(), /Non vérifié auprès du prestataire/)
    checks += 2
    await page.screenshot({ path: new URL(`${name}-detail.png`, output).pathname, fullPage: true })
    await page.getByRole('button', { name: 'Fermer le détail' }).click()
    await page.getByLabel(/^Origine/).selectOption('google')
    assert.equal(await page.getByRole('button', { name: /Camille TEST/ }).count(), 0)
    checks++
    await page.getByRole('button', { name: /Créneau Google TEST/ }).first().click()
    assert.match(await page.getByRole('complementary').innerText(), /Aucun paiement MediumIA associé/)
    checks++
    await page.getByRole('button', { name: 'Fermer le détail' }).click()
    await page.getByLabel(/^Origine/).selectOption('all')
    await page.getByRole('button', { name: 'Semaine', exact: true }).click()
    await page.getByRole('button', { name: 'Jour', exact: true }).click()
    assert.equal(await page.locator('.fc-timeGridDay-view').count(), 1)
    checks++
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    checks++
    assert.deepEqual(errors, [])
    assert.ok(requests >= 1)
    checks += 2
    await page.screenshot({ path: new URL(`${name}-day.png`, output).pathname, fullPage: true })
    await context.close()
  }
  console.log(`${checks} browser checks passed; fictional responses only; external requests blocked`)
} finally {
  await browser.close()
}
