import { test as base, expect } from '@playwright/test'
export { expect }
export const test = base.extend({
  localOnly: [async ({ context, page }, use) => {
    const violations = [], errors = []
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue()
      if (url.hostname.includes('supabase') || url.pathname.startsWith('/api/')) violations.push(url.origin + url.pathname)
      return route.abort()
    })
    await use()
    expect(violations, 'aucun appel backend ou Supabase').toEqual([])
    expect(errors, 'aucune erreur React').toEqual([])
  }, { auto: true }],
})
