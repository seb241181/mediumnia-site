import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'

// Local components/fictional fixture only. Does not log in or consume app credentials.
const { chromium } = createRequire(import.meta.url)('playwright')
const origin = 'http://127.0.0.1:4187'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const checks = []
const check = (name, condition) => { assert.ok(condition, name); checks.push(name) }
await mkdir(new URL('../../docs/captures/', import.meta.url), { recursive: true })
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, timezoneId: 'Europe/Paris' })
    const errors = []
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${origin}/tests/fixtures/rdv-coulisses-preview.html`)
    await page.getByText('Reste 50,00', { exact: false }).first().waitFor()
    await page.waitForFunction(() => document.querySelectorAll('details').length === 2)
    check(`${name}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    check(`${name}: paid groups closed`, await page.locator('details[open]').count() === 0)
    check(`${name}: paid client hidden initially`, !await page.getByText('Client fictif B', { exact: false }).first().isVisible())
    await page.screenshot({ path: new URL(`../../docs/captures/rdv-coulisses-${name}.png`, import.meta.url).pathname, fullPage: true })
    await page.locator('summary').first().click()
    check(`${name}: paid client visible after expand`, await page.getByText('Client fictif B', { exact: false }).first().isVisible())
    await page.getByRole('button', { name: /Contacté/ }).click()
    check(`${name}: request filter selects contacted`, await page.getByText('Demande fictive B', { exact: true }).isVisible()
      && await page.getByText('Demande fictive A', { exact: true }).count() === 0)
    await page.getByRole('button', { name: 'Examiner l’annulation' }).first().click()
    await page.getByText('Net enregistré MediumIA', { exact: true }).waitFor()
    const approve = page.getByRole('button', { name: 'Valider le contrôle' })
    check(`${name}: explicit confirmation required`, !await approve.isEnabled())
    await page.getByRole('checkbox').check()
    await approve.click()
    await page.getByText('Contrôle validé localement.', { exact: false }).waitFor()
    check(`${name}: prepared cancellation stays non-operative`, await page.getByText('Annulation non activée', { exact: false }).isVisible())
    check(`${name}: dialog fits viewport`, await page.getByRole('dialog').evaluate(element => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
    }))
    if (name === 'mobile') await page.screenshot({ path: new URL('../../docs/captures/rdv-coulisses-mobile-dialog.png', import.meta.url).pathname })
    await page.getByRole('button', { name: 'Fermer', exact: true }).click()
    check(`${name}: only mocked GET requests`, await page.evaluate(() => window.__fixtureRequests.every(call => call.method === 'GET')))
    check(`${name}: no browser exception`, errors.length === 0)
    await context.close()
  }
  console.log(JSON.stringify({ passed: checks.length, failed: 0, checks }))
} finally { await browser.close() }
