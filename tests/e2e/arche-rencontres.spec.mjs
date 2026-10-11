// Test facultatif de navigateur pour l’espace Rencontres (non inclus dans "node --test").
// Même mise en place que tests/e2e/arche-touch.spec.mjs :
//   npm install --no-save @playwright/test@1.56.1
//   npm run build && npm run preview -- --host 127.0.0.1
//   npx playwright test tests/e2e/arche-rencontres.spec.mjs --workers=1
// Données fictives uniquement, aucune écriture distante.
import { test, expect } from './arche-test-fixtures.mjs'

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
  const submit = page.getByRole('button', { name: 'Créer mon profil' })
  await expect(submit).toBeDisabled()
  await page.getByRole('radio', { name: 'Amitié', exact:true }).check()
  if (intentions.includes('Relation amoureuse')) await page.getByRole('radio', { name:'Les deux', exact:true }).check()
  await expect(submit).toBeDisabled()
  await page.getByRole('checkbox', { name: /J’ai 18 ans ou plus/ }).check()
  await submit.click()
}

test('iPhone : les cinq onglets restent touchables, Rencontres désactivé par défaut', async ({ page }) => {
  await enterRencontres(page)
  const nav = page.getByRole('navigation', { name: /Navigation principale L’Arche/i })
  for (const title of ['Fil', 'Cercles', 'Rencontres', 'Messages', 'Moi']) {
    const box = await nav.getByRole('button', { name: title, exact: true }).boundingBox()
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') || '', { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    expect(hit).toBe(title)
  }
  await nav.getByRole('button', { name: 'Rencontres', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Faisons connaissance/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Des personnes à découvrir' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('Filtres, fiche puis invitation : pas de message libre avant acceptation', async ({ page }) => {
  await enterRencontres(page)
  await join(page)
  await expect(page.getByRole('heading', { name: 'Des personnes à découvrir' })).toBeVisible()
  // Le titre d’accueil occupe toute la largeur sur iPhone (il n’est plus écrasé par « Mon profil Rencontres »).
  const title = await page.locator('#rencontres-title').boundingBox()
  expect(title.width).toBeGreaterThan(300)
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
  await page.getByRole('button', { name: 'Ouvrir dans Messages' }).click()
  await page.getByRole('textbox', { name: 'Écrire un message fictif' }).fill('Bonjour, ravi de vous lire !')
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

test('Invitations reçues : ignorer sans prévenir, refuser sans relance, puis revenir sur sa décision', async ({ page }) => {
  await enterRencontres(page)
  await join(page)
  await page.getByRole('article').filter({ hasText: 'Petit Phare aimerait' }).getByRole('button', { name: 'Ignorer' }).click()
  await page.getByRole('button', { name: 'Invitations mises de côté (1)' }).click()
  await page.getByRole('button', { name: 'Revoir l’invitation' }).click()
  await page.getByRole('article').filter({ hasText: 'Petit Phare aimerait' }).getByRole('button', { name: 'Refuser' }).click()
  await expect(page.getByText('Petit Phare aimerait faire connaissance')).toHaveCount(0)
  await expect(page.getByText(/aucun motif, aucune relance possible/)).toBeVisible()
  // Seule la personne qui a refusé peut rouvrir l’invitation, depuis la fiche.
  await page.getByRole('button', { name: 'Invitation refusée — Petit Phare' }).click()
  await expect(page.getByRole('heading', { name: 'Vous avez refusé cette invitation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Faire connaissance', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Revenir sur ma décision' }).click()
  await page.getByRole('group', { name: 'Répondre à l’invitation de Petit Phare' }).getByRole('button', { name: 'Accepter' }).click()
  await page.getByRole('button', { name: 'Ouvrir dans Messages' }).click()
  await expect(page.getByRole('textbox', { name: 'Écrire un message fictif' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Envoyer une Lueur' })).toHaveCount(0)
})

test('Dès la demande initiale : signaler sans bloquer, puis bloquer et signaler depuis la fiche', async ({ page }) => {
  await enterRencontres(page)
  await join(page)
  await page.getByRole('article').filter({ hasText: 'Bois Flotté aimerait' }).getByRole('button', { name: 'Voir son profil' }).click()
  const actions = page.getByRole('group', { name: 'Répondre à l’invitation de Bois Flotté' })
  await expect(page.getByRole('textbox', { name: /Écrire à/ })).toHaveCount(0)
  await actions.getByRole('button', { name: 'Bloquer et signaler' }).click()
  await page.getByRole('radio', { name: 'Faux profil' }).check()
  await page.getByRole('checkbox', { name: 'Bloquer aussi cette personne' }).uncheck()
  await page.getByRole('button', { name: 'Envoyer le signalement' }).click()
  await expect(page.getByText('Signalement simulé : rien n’a été transmis.')).toBeVisible()
  await expect(actions).toBeVisible()
  await actions.getByRole('button', { name: 'Bloquer et signaler' }).click()
  await expect(page.getByRole('checkbox', { name: 'Bloquer aussi cette personne' })).toBeChecked()
  await page.getByRole('radio', { name: 'Comportement insistant' }).check()
  await page.getByRole('button', { name: 'Envoyer le signalement' }).click()
  await expect(page.getByRole('heading', { name: 'Des personnes à découvrir' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Bois Flotté' })).toHaveCount(0)
  await expect(page.getByText('Bois Flotté aimerait faire connaissance')).toHaveCount(0)
})

test('Avatars choisis par les personnes, initiale neutre à défaut de choix', async ({ page }) => {
  await enterRencontres(page)
  await join(page)
  await expect(page.getByRole('img', { name: 'Avatar choisi par Lune Sereine : Lune' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Avatar par défaut de Sentier Vert' })).toBeVisible()
})

test('Ordinateur : Rencontres accessible depuis la navigation latérale', async ({ page }) => {
  await enterRencontres(page, 1440)
  await join(page)
  await expect(page.getByRole('heading', { name: 'Des personnes à découvrir' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Se connecter à MediumIA|Ouvrir mon compte MediumIA/i })).toHaveCount(0)
})
