import { expect, test as base } from '@playwright/test'

/** Ordinary product tests never reach a possibly running, paid local model server. */
export const test = base.extend<{ offlineModel: void }>({
  offlineModel: [async ({ page }, use) => {
    const unexpectedRequests: string[] = []
    await page.route('**/api/ai/model-status', (route) => {
      if (route.request().method() !== 'GET') unexpectedRequests.push('model-status write')
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'unavailable', model: null }),
      })
    })
    for (const endpoint of ['private-chat', 'private-question', 'synthetic-question']) {
      await page.route(`**/api/ai/${endpoint}`, (route) => {
        unexpectedRequests.push(`${endpoint} request`)
        return route.fulfill({
          status: 503, contentType: 'application/json',
          body: JSON.stringify({ status: 'error', code: 'model_not_configured' }),
        })
      })
    }
    await use()
    expect(unexpectedRequests).toEqual([])
  }, { auto: true }],
})

export { expect }
