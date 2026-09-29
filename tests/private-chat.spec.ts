import { expect, test, type Page, type Route } from '@playwright/test'

test.use({ timezoneId: 'Asia/Shanghai' })

const reply = (answer: string, nextQuestion: string | null = null) => ({
  status: 'generated', reply: answer, nextQuestion, citations: [],
  model: { provider: 'qwen', id: 'fake-qwen' }, generatedAt: '2026-09-29T09:00:00Z',
})

async function modelStatus(page: Page, ready: () => boolean = () => true) {
  await page.route('**/api/ai/model-status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      ready() ? { status: 'ready', model: { provider: 'qwen', id: 'fake-qwen' } } :
        { status: 'unavailable', model: null },
    ) })
  })
}

test('one composer sends three natural turns automatically with bounded context and no device data', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await modelStatus(page)
  const requests: Array<Record<string, unknown>> = []
  const responses = [
    reply('你好，我在。想聊什么都可以。'),
    reply('听起来你走了不少路。', '走完这段路，你现在想休息吗？'),
    reply('明白了，你说的是累；我会以你的补充为准。'),
  ]
  await page.route('**/api/ai/private-chat', async (route) => {
    requests.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>)
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(responses[requests.length - 1]) })
  })
  await page.goto('/')
  const chat = page.getByRole('region', { name: '对话记录' })
  const composer = page.getByRole('textbox', { name: '发送消息' })
  const send = page.getByRole('button', { name: '发送', exact: true })
  await expect(page.locator('[aria-label="模型状态"]')).toContainText('当前模型：fake-qwen（本机已配置）')
  await expect(chat).toContainText('同日最近最多两条已发给模型的对话文字')
  await expect(chat.getByRole('button', { name: '千问聊天' })).toHaveCount(0)

  await composer.fill('你好')
  await send.click()
  await expect(chat).toContainText('你好，我在。想聊什么都可以。')
  expect(requests[0]).toEqual({ turn: expect.objectContaining({ quote: '你好' }), context: [] })
  await expect(page.getByRole('dialog', { name: '查看这一次发给千问的内容' })).toHaveCount(0)

  await page.getByRole('button', { name: '生活数据' }).click()
  await page.getByRole('button', { name: '开启手表步数模拟授权' }).click()
  await page.getByRole('button', { name: '对话' }).click()
  await composer.fill('今天走了很远的路。')
  await send.click()
  await expect(chat).toContainText('走完这段路，你现在想休息吗？')
  expect((requests[1].context as Array<{ quote: string }>).map((source) => source.quote)).toEqual(['你好'])
  expect(requests[1].precedingAssistant).toEqual({ reply: '你好，我在。想聊什么都可以。', nextQuestion: null })

  await composer.fill('不是开心，是有点累。')
  await send.click()
  await expect(chat).toContainText('我会以你的补充为准')
  expect(requests).toHaveLength(3)
  expect((requests[2].turn as { quote: string }).quote).toBe('不是开心，是有点累。')
  expect((requests[2].context as Array<{ quote: string }>).map((source) => source.quote))
    .toEqual(['今天走了很远的路。', '你好'])
  expect(JSON.stringify(requests)).not.toContain('steps')
  expect(JSON.stringify(requests)).not.toContain('spending')
  await expect(chat.locator('.product-ai-reply')).toHaveCount(3)
  await page.screenshot({ path: 'test-results/private-chat-auto-three-turns-375.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376)

  await page.getByRole('button', { name: '画册' }).click()
  const album = page.getByRole('article', { name: '第 1 天画册页' })
  await expect(album).toContainText('今天走了很远的路。')
  await expect(album).not.toContainText('听起来你走了不少路。')
})

test('offline words are never silently included when the model becomes available on the next send', async ({ page }) => {
  let ready = false
  await modelStatus(page, () => ready)
  const requests: Array<Record<string, unknown>> = []
  await page.route('**/api/ai/private-chat', async (route) => {
    requests.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply('服务已经接上。')) })
  })
  await page.goto('/')
  await expect(page.locator('[aria-label="模型状态"]')).toContainText('模型未连接')
  const composer = page.getByRole('textbox', { name: '发送消息' })
  const send = page.getByRole('button', { name: '发送', exact: true })
  await composer.fill('离线时只留在本页的私密旧句。')
  await send.click()
  await expect(page.getByRole('region', { name: '对话记录' }).locator('.product-bubble-row.user'))
    .toContainText('离线时只留在本页的私密旧句。')
  expect(requests).toHaveLength(0)

  ready = true
  await composer.fill('服务启动后新写的一句。')
  await expect(send).toBeEnabled()
  await send.click()
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('服务已经接上。')
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ turn: { quote: '服务启动后新写的一句。' }, context: [] })
  expect(JSON.stringify(requests[0])).not.toContain('离线时只留在本页的私密旧句。')
  await expect(page.locator('[aria-label="模型状态"]')).toContainText('当前模型：fake-qwen（本机已配置）')
})

test('an older local service returning HTML 404 uses local rules without posting chat', async ({ page }) => {
  await page.route('**/api/ai/model-status', async (route) => route.fulfill({
    status: 404, contentType: 'text/html', body: '<html>Not Found</html>',
  }))
  let chatCalls = 0
  await page.route('**/api/ai/private-chat', async (route) => {
    chatCalls += 1
    await route.fulfill({ status: 503, body: '{}' })
  })
  await page.goto('/')
  await expect(page.locator('[aria-label="模型状态"]')).toContainText('模型未连接 · 本地记录')
  await page.getByRole('textbox', { name: '发送消息' }).fill('旧本机服务下的这句只在本地。')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('region', { name: '对话记录' }).locator('.product-bubble-row.user'))
    .toContainText('旧本机服务下的这句只在本地。')
  expect(chatCalls).toBe(0)
})

test('a model failure keeps the local words and never fabricates a reply or exposes provider text', async ({ page }) => {
  await modelStatus(page)
  let calls = 0
  await page.route('**/api/ai/private-chat', async (route) => {
    calls += 1
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({
      status: 'error', code: 'invalid_model_output', message: 'do-not-display-provider-text',
    }) })
  })
  await page.goto('/')
  await expect(page.locator('[aria-label="模型状态"]')).toContainText('本机已配置')
  await page.getByRole('textbox', { name: '发送消息' }).fill('这一句先留下。')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const chat = page.getByRole('region', { name: '对话记录' })
  await expect(chat.getByRole('alert')).toContainText('回复未通过格式与引用检查')
  await expect(chat.getByRole('alert')).not.toContainText('do-not-display-provider-text')
  await expect(chat.locator('.product-ai-reply')).toHaveCount(0)
  expect(calls).toBe(1)
  await page.getByRole('button', { name: '画册' }).click()
  await expect(page.getByRole('article', { name: '第 1 天画册页' })).toContainText('这一句先留下。')
})

test('editing a sent source withdraws its reply and later replies that used it', async ({ page }) => {
  await modelStatus(page)
  let calls = 0
  await page.route('**/api/ai/private-chat', async (route) => {
    calls += 1
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(reply(calls === 1 ? '第一条模型回应。' : '第二条依赖前文的回应。')) })
  })
  await page.goto('/')
  await expect(page.locator('[aria-label="模型状态"]')).toContainText('本机已配置')
  const composer = page.getByRole('textbox', { name: '发送消息' })
  const send = page.getByRole('button', { name: '发送', exact: true })
  await composer.fill('我在公园看见小花。')
  await send.click()
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('第一条模型回应。')
  await composer.fill('再说说这件事。')
  await send.click()
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('第二条依赖前文的回应。')
  await page.getByRole('button', { name: '画册' }).click()
  await page.locator('.product-album-tools > summary').click()
  await page.getByRole('button', { name: '修改这条原话' }).first().click()
  await page.getByRole('textbox', { name: '修改原话' }).fill('我在公园看见一棵树。')
  await page.getByRole('button', { name: '保存修改' }).click()
  await page.getByRole('button', { name: '对话' }).click()
  const chat = page.getByRole('region', { name: '对话记录' })
  await expect(chat).not.toContainText('第一条模型回应。')
  await expect(chat).not.toContainText('第二条依赖前文的回应。')
  await expect(chat).not.toContainText('我在公园看见小花。')
})

test('rapid double-submit sends one request; clearing during a slow reply discards the late answer', async ({ page }) => {
  await modelStatus(page)
  let calls = 0
  let heldRoute: Route | null = null
  await page.route('**/api/ai/private-chat', async (route) => {
    calls += 1
    heldRoute = route
  })
  await page.goto('/')
  await expect(page.locator('[aria-label="模型状态"]')).toContainText('本机已配置')
  const composer = page.getByRole('textbox', { name: '发送消息' })
  await composer.fill('只应发送一次。')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await composer.press('Enter')
  await expect.poll(() => heldRoute !== null).toBe(true)
  expect(calls).toBe(1)
  await expect(page.getByRole('region', { name: '对话记录' }).locator('.product-bubble-row.user'))
    .toHaveCount(1)
  await page.getByRole('button', { name: '清除本次内容' }).click()
  if (heldRoute) {
    try { await heldRoute.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(reply('不应出现的迟到回复。')) }) } catch { /* Aborted requests can reject fulfillment. */ }
  }
  await expect(page.getByRole('region', { name: '对话记录' })).not.toContainText('不应出现的迟到回复。')
  await expect(page.getByRole('region', { name: '对话记录' })).not.toContainText('只应发送一次。')
})
