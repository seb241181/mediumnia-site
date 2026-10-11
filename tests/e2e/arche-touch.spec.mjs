// Test facultatif de navigateur : non inclus dans les tests "node --test" de Vercel.
// Prérequis locaux, dans un environnement de test indépendant :
//   npm install --no-save @playwright/test@1.56.1
//   npx playwright install chromium
// Terminal 1 : npm run build && npm run preview -- --host 127.0.0.1
// Terminal 2 : npx playwright test tests/e2e/arche-touch.spec.mjs --workers=1
// Pour le serveur "npm run dev", définir ARCHE_BASE_URL=http://127.0.0.1:5173.
// Aucune écriture distante, aucun véritable compte.
import { test, expect } from './arche-test-fixtures.mjs'

test.use({ baseURL: process.env.ARCHE_BASE_URL || 'http://127.0.0.1:4173' })

async function enterDemo(page) {
  await page.goto('/arche')
  await page.getByRole('button', { name: /Se connecter à L’Arche/i }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: /Entrer dans l’application/i }).click()
  await expect(page.locator('[data-arche-app-preview="local-only"]')).toBeVisible()
}

test('iPhone : les cinq onglets captent chacun le toucher au centre, sans launcher MediumIA', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enterDemo(page)
  const nav = page.getByRole('navigation', { name: /Navigation principale L’Arche/i })
  for (const title of ['Fil', 'Cercles', 'Rencontres', 'Messages', 'Moi']) {
    const button = nav.getByRole('button', { name: title, exact: true })
    const box = await button.boundingBox()
    expect(box, 'onglet '+title+' introuvable').not.toBeNull()
    const hit = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y)
      return target?.closest('button')?.getAttribute('aria-label') || ''
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    expect(hit, 'onglet '+title+' recouvert par un autre élément').toBe(title)
    await button.click()
  }
  await expect(page.getByRole('button', { name: /Se connecter à MediumIA|Ouvrir mon compte MediumIA/i })).toHaveCount(0)
})

test('Ordinateur : aucun bouton Compte MediumIA flottant sur /arche', async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 820 })
  await enterDemo(page)
  await expect(page.getByRole('navigation', { name: 'Navigation latérale L’Arche' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Se connecter à MediumIA|Ouvrir mon compte MediumIA/i })).toHaveCount(0)
})

test('La demande acceptée et les messages restent présents après passage par le profil', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enterDemo(page)
  const nav = page.getByRole('navigation', { name: /Navigation principale L’Arche/i })
  await nav.getByRole('button', { name: 'Messages', exact: true }).click()
  await page.getByRole('button', { name: /Aurore/ }).first().click()
  await page.getByRole('button', { name: 'Accepter', exact: true }).click()
  await page.getByRole('textbox', { name: /Écrire un message fictif/i }).fill('Bonjour, voilà notre essai !')
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click()
  await nav.getByRole('button', { name: 'Moi', exact: true }).click()
  await nav.getByRole('button', { name: 'Messages', exact: true }).click()
  await expect(page.getByText('Bonjour, voilà notre essai !')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accepter', exact: true })).toHaveCount(0)
})
