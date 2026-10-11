// Test facultatif de navigateur pour l’espace Rencontres (non inclus dans "node --test").
// Même mise en place que tests/e2e/arche-touch.spec.mjs :
//   npm install --no-save @playwright/test@1.56.1
//   npm run build && npm run preview -- --host 127.0.0.1
//   npx playwright test tests/e2e/arche-rencontres.spec.mjs --workers=1
// Données fictives uniquement, aucune écriture distante.
import { test, expect } from '@playwright/test'

test.use({ baseURL: process.env.ARCHE_BASE_URL || 'http://127.0.0.1:4173' })

async function enterRencontres(page, width = 390) {
  await page.setViewportSize({ width, height: 844 })
  await page.goto('/arche')
  await page.getByRole('button', { name: /Se connecter à L’Arche/i }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: /Entrer dans l’application/i }).click()
  await expect(page.locator('[data-arche-app-preview="local-only"]')).toBeVisible()
  const nav = width < 1024
    ? page.getByRole('navigation', { name: /Navigation principale L’Arche/i })
    : page.getByRole('navigation', { name: 'Navigation latérale L’Arche' })
  await nav.getByRole('button', { name: 'Rencontres', exact: true }).click()
}

async function join(page, intentions = ['Amitié', 'Échanges et découvertes']) {
  const submit = page.getByRole('button', { name: 'Rejoindre les Rencontres' })
  await expect(submit).toBeDisabled()
  for (const label of intentions) await page.getByRole('checkbox', { name: new RegExp(label) }).check()
  await expect(submit).toBeDisabled()
  await page.getByRole('checkbox', { name: /J’ai 18 ans ou plus/ }).check()
  await submit.click()
}

test('iPhone : les six onglets restent touchables, Rencontres désactivé par défaut', async ({ page }) => {
  await enterRencontres(page)
  const nav = page.getByRole('navigation', { name: /Navigation principale L’Arche/i })
  for (const title of ['Fil', 'Salon', 'Cercles', 'Rencontres', 'Messages', 'Moi']) {
    const box = await nav.getByRole('button', { name: title, exact: true }).boundingBox()
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') || '', { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    expect(hit).toBe(title)
  }
  await nav.getByRole('button', { name: 'Rencontres', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Les belles rencontres commencent/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Des personnes à découvrir' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('Filtres, fiche puis invitation : pas de message libre avant acceptation', async ({ page }) => {
  await enterRencontres(page)
  await join(page)
  await expect(page.getByRole('heading', { name: 'Des personnes à découvrir' })).toBeVisible()
  // L’intention amoureuse n’apparaît pas à qui ne l’a pas choisie.
  await expect(page.getByRole('button', { name: 'Relation amoureuse', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Échanges et découvertes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Lune Sereine' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Sentier Vert' })).toBeVisible()
  await page.getByRole('button', { name: 'Faire connaissance — Sentier Vert' }).click()
  await expect(page.getByRole('heading', { name: 'Sentier Vert', level: 2 })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /Écrire à/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Envoyer l’invitation' }).click()
  await expect(page.getByRole('heading', { name: 'Invitation envoyée' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /Écrire à/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Simuler une acceptation' }).click()
  await page.getByRole('textbox', { name: 'Écrire à Sentier Vert' }).fill('Bonjour, ravi de vous lire !')
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click()
  await expect(page.getByText('Bonjour, ravi de vous lire !')).toBeVisible()
})

test('Invitations reçues : accepter, bloquer et signaler', async ({ page }) => {
  await enterRencontres(page)
  await join(page)
  const invitations = page.getByRole('region', { name: 'Invitations reçues' })
  await expect(invitations.getByText(/aimerait faire connaissance/)).toHaveCount(2)
  await invitations.getByRole('article').filter({ hasText: 'Petit Phare' }).getByRole('button', { name: 'Accepter' }).click()
  await expect(page.getByRole('button', { name: 'Écrire à Petit Phare' })).toBeVisible()
  await page.getByRole('article').filter({ hasText: 'Bois Flotté aimerait' }).getByRole('button', { name: 'Bloquer et signaler' }).click()
  await page.getByRole('radio', { name: 'Comportement insistant' }).check()
  await page.getByRole('button', { name: 'Envoyer le signalement' }).click()
  await expect(page.getByRole('heading', { name: 'Bois Flotté' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Invitations reçues' })).toHaveCount(0)
  const nav = page.getByRole('navigation', { name: /Navigation principale L’Arche/i })
  await nav.getByRole('button', { name: 'Moi', exact: true }).click()
  await expect(page.getByText('Bois Flotté', { exact: true })).toBeVisible()
})

test('Invitations reçues : ignorer sans prévenir, revoir, puis refuser', async ({ page }) => {
  await enterRencontres(page)
  await join(page)
  await page.getByRole('article').filter({ hasText: 'Petit Phare aimerait' }).getByRole('button', { name: 'Ignorer' }).click()
  await page.getByRole('button', { name: 'Invitations ignorées (1)' }).click()
  await page.getByRole('button', { name: 'Revoir l’invitation' }).click()
  await page.getByRole('article').filter({ hasText: 'Petit Phare aimerait' }).getByRole('button', { name: 'Refuser' }).click()
  await expect(page.getByText('Petit Phare aimerait faire connaissance')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pas de suite — Petit Phare' })).toBeDisabled()
})

test('Ordinateur : Rencontres accessible depuis la navigation latérale', async ({ page }) => {
  await enterRencontres(page, 1440)
  await join(page)
  await expect(page.getByRole('heading', { name: 'Des personnes à découvrir' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Se connecter à MediumIA|Ouvrir mon compte MediumIA/i })).toHaveCount(0)
})
