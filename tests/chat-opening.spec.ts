import { expect, test } from '@playwright/test'

test.use({ timezoneId: 'Asia/Shanghai' })

const periods = [
  ['morning', '08:00', '早上好呀', '今天有什么让你期待的安排？'],
  ['noon', '12:00', '中午好呀', '今天午饭吃了什么，或者准备吃什么？'],
  ['afternoon', '15:00', '下午好呀', '你刚刚在做什么？'],
  ['evening', '20:00', '晚上好呀', '今天有没有什么小事，想跟我分享？'],
  ['late-night', '01:00', '这个时间', '此刻有什么在你脑海里打转？'],
] as const

for (const [id, hour, greeting, question] of periods) {
  test(`${id}: local opening survives tabs and clock change; first answer carries context`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(`2026-09-29T${hour}:00+08:00`))
    const requests: Record<string, unknown>[] = []
    await page.route('**/api/ai/model-status', (route) => route.fulfill({ json: {
      status: 'ready', model: { provider: 'qwen', id: 'fake-qwen' },
    } }))
    await page.route('**/api/ai/private-chat', (route) => {
      requests.push(route.request().postDataJSON())
      return route.fulfill({ json: { status: 'generated', reply: '那就慢慢聊。', nextQuestion: null,
        citations: [], model: { provider: 'qwen', id: 'fake-qwen' }, generatedAt: new Date().toISOString() } })
    })
    await page.goto('/')
    const opening = page.getByLabel('知知的开场白')
    await expect(opening).toContainText(greeting)
    await expect(opening).toContainText(question)
    await expect(page.getByLabel('模型状态')).toContainText('本机已配置')
    expect(requests).toHaveLength(0)
    await page.getByRole('button', { name: '画册', exact: true }).click()
    await expect(page.getByRole('heading', { name: '日子，值得慢慢翻阅。' })).toBeVisible()
    await page.clock.setFixedTime(new Date('2026-09-30T14:30:00+08:00'))
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await expect(opening).toHaveCount(1)
    await expect(opening).toContainText(question)
    if (id === 'morning') {
      await page.setViewportSize({ width: 375, height: 812 })
      await page.screenshot({ path: 'test-results/chat-opening-morning-375.png' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    }
    await page.getByRole('textbox', { name: '发送消息' }).fill('有点累')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('那就慢慢聊。', { exact: true })).toBeVisible()
    expect(requests[0]).toMatchObject({ openingId: id, context: [], turn: { quote: '有点累' } })
    expect(requests[0]).not.toHaveProperty('precedingAssistant')
    await page.getByRole('textbox', { name: '发送消息' }).fill('想休息会儿')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[1]).not.toHaveProperty('openingId')
    await expect(opening).toHaveCount(1)
    if (id === 'morning') {
      await page.getByRole('button', { name: '清除本次内容' }).click()
      await page.getByRole('button', { name: '确认清除本机记录' }).click()
      await expect(opening).toContainText('下午好呀')
      await expect(opening).toHaveCount(1)
      expect(requests).toHaveLength(2)
    }
  })
}

test('offline opening stays local; pause hides unanswered invitation', async ({ page }) => {
  await page.route('**/api/ai/model-status', (route) => route.fulfill({ json: { status: 'unavailable', model: null } }))
  let calls = 0
  await page.route('**/api/ai/private-chat', (route) => { calls++; return route.abort() })
  await page.goto('/')
  await expect(page.getByLabel('知知的开场白')).toHaveCount(1)
  await expect(page.getByLabel('模型状态')).toContainText('模型未连接')
  await expect(page.locator('.product-bubble-row.agent.current')).toHaveCount(0)
  await page.getByLabel('邀请节奏与演示日期', { exact: true }).click()
  await page.getByRole('button', { name: '暂停邀请', exact: true }).click()
  await expect(page.getByLabel('知知的开场白')).toHaveCount(0)
  expect(calls).toBe(0)
})
