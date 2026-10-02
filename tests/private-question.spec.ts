import { expect, test } from '@playwright/test'

test('the main conversation has no separate per-question model consent flow', async ({ page }) => {
  await page.route('**/api/ai/model-status', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'ready', model: { provider: 'qwen', id: 'fake-qwen' } }),
  }))
  let oldQuestionCalls = 0
  await page.route('**/api/ai/private-question', async (route) => {
    oldQuestionCalls += 1
    await route.fulfill({ status: 503, body: '{}' })
  })
  await page.route('**/api/ai/private-chat', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      status: 'generated', reply: '今天愿意留下这一句，也很好。',
      nextQuestion: '这段经历里，你最想记住哪个细节？', citations: [],
      model: { provider: 'qwen', id: 'fake-qwen' }, generatedAt: '2026-09-29T09:00:00Z',
    }),
  }))
  await page.goto('/')
  await expect(page.locator('[aria-label="模型状态"]')).toContainText('本机已配置')
  await expect(page.getByRole('button', { name: '让千问提议这一问' })).toHaveCount(0)
  await page.getByRole('textbox', { name: '发送消息' }).fill('今天走过一条安静的街。')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('region', { name: '对话记录' }))
    .toContainText('这段经历里，你最想记住哪个细节？')
  await expect(page.getByRole('dialog', { name: '让千问提议这一问' })).toHaveCount(0)
  expect(oldQuestionCalls).toBe(0)
})
