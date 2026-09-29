import { expect, test, type Route } from '@playwright/test'

test.use({ timezoneId: 'Asia/Shanghai' })

const reply = (answer: string, nextQuestion: string | null = null) => ({
  status: 'generated', reply: answer, nextQuestion, citations: [],
  model: { provider: 'qwen', id: 'fake-qwen' }, generatedAt: '2026-09-29T09:00:00Z',
})

test('three natural turns use the main composer without the daily question cap', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const requests: Array<Record<string, unknown>> = []
  const responses = [
    reply('你好，我在。想聊什么都可以。'),
    reply('听起来你走了不少路。', '走完这段路，你现在想休息吗？'),
    reply('明白了，你刚才说的是累，不是开心；我会以你的纠正为准。'),
  ]
  await page.route('**/api/ai/private-chat', async (route) => {
    requests.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>)
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(responses[requests.length - 1]) })
  })
  await page.goto('/')
  const chat = page.getByRole('region', { name: '对话记录' })
  await chat.getByRole('button', { name: '千问聊天' }).click()
  await expect(chat).not.toContainText('今天，哪一件小事最想留下来？')
  const composer = page.getByRole('textbox', { name: '发送消息' })
  const send = page.getByRole('button', { name: '发送', exact: true })
  const dialog = page.getByRole('dialog', { name: '查看这一次发给千问的内容' })

  await composer.fill('你好')
  await send.click()
  await expect(dialog).toBeVisible()
  expect(requests).toHaveLength(0)
  await expect(dialog.getByText('本次实际请求')).toBeVisible()
  await expect(dialog.locator('.product-chat-payload')).toContainText('"quote": "你好"')
  await page.screenshot({ path: 'test-results/private-chat-consent-375.png' })
  const firstPreview = JSON.parse(await dialog.locator('.product-chat-payload').textContent() ?? '{}')
  await dialog.getByRole('button', { name: '同意并发送这一次' }).click()
  await expect(chat).toContainText('你好，我在。想聊什么都可以。')
  expect(requests[0]).toEqual(firstPreview)
  await expect(composer).toBeEnabled()

  await composer.fill('今天走了很远的路。')
  await send.click()
  await expect(dialog.getByText('带上上一条有效的千问回复与追问')).toBeVisible()
  await dialog.locator('.product-chat-context input[type="checkbox"]').uncheck()
  await dialog.locator('.product-chat-preceding input[type="checkbox"]').uncheck()
  const secondPreview = JSON.parse(await dialog.locator('.product-chat-payload').textContent() ?? '{}')
  await dialog.getByRole('button', { name: '同意并发送这一次' }).click()
  await expect(chat).toContainText('走完这段路，你现在想休息吗？')
  expect(requests[1]).toEqual(secondPreview)
  expect(requests[1].context).toEqual([])
  expect(requests[1]).not.toHaveProperty('precedingAssistant')
  await expect(send).toBeDisabled()

  await composer.fill('不是开心，是有点累。')
  await send.click()
  await expect(dialog.locator('.product-chat-payload')).toContainText('不是开心，是有点累。')
  await dialog.getByRole('button', { name: '同意并发送这一次' }).click()
  await expect(chat).toContainText('我会以你的纠正为准')
  expect(requests).toHaveLength(3)
  expect((requests[2].turn as { quote: string }).quote).toBe('不是开心，是有点累。')
  expect((requests[2].context as Array<{ quote: string }>).some((item) => item.quote === '今天走了很远的路。')).toBe(true)
  await expect(chat.locator('.product-ai-reply')).toHaveCount(3)
  await page.screenshot({ path: 'test-results/private-chat-three-turns-375.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376)

  await page.getByRole('button', { name: '画册' }).click()
  const album = page.getByRole('article', { name: '第 1 天画册页' })
  await expect(album).toContainText('今天走了很远的路。')
  await expect(album).toContainText('不是开心，是有点累。')
  await expect(album).not.toContainText('听起来你走了不少路。')
})

test('cancel sends nothing; refusal can be answered; unavailable model keeps the local words', async ({ page }) => {
  let calls = 0
  await page.route('**/api/ai/private-chat', async (route) => {
    calls += 1
    if (calls === 1) {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(reply('好，今天不回答也可以。想说时我在。')) })
    } else {
      await route.fulfill({ status: 503, contentType: 'application/json',
        body: '{"status":"error","code":"model_not_configured"}' })
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: '千问聊天' }).click()
  const composer = page.getByRole('textbox', { name: '发送消息' })
  const send = page.getByRole('button', { name: '发送', exact: true })
  const dialog = page.getByRole('dialog', { name: '查看这一次发给千问的内容' })

  await composer.fill('先只记下来。')
  await send.click()
  await dialog.getByRole('button', { name: '仅保留本地' }).click()
  expect(calls).toBe(0)

  await composer.fill('今天不想回答')
  await send.click()
  await dialog.getByRole('button', { name: '同意并发送这一次' }).click()
  await expect(page.getByRole('region', { name: '对话记录' }))
    .toContainText('好，今天不回答也可以。想说时我在。')
  expect(calls).toBe(1)

  await composer.fill('我还是想记一下雨声。')
  await send.click()
  await dialog.getByRole('button', { name: '同意并发送这一次' }).click()
  await expect(page.locator('.product-status')).toContainText('本机千问聊天尚未启用')
  expect(calls).toBe(2)
  await page.getByRole('button', { name: '画册' }).click()
  await expect(page.getByRole('article', { name: '第 1 天画册页' }))
    .toContainText('我还是想记一下雨声。')
})

test('editing a sent source withdraws its reply and later replies that reused it', async ({ page }) => {
  let calls = 0
  await page.route('**/api/ai/private-chat', async (route) => {
    calls += 1
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(reply(calls === 1 ? '第一条模型回应。' : '第二条依赖前文的回应。')) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '千问聊天' }).click()
  const composer = page.getByRole('textbox', { name: '发送消息' })
  const send = page.getByRole('button', { name: '发送', exact: true })
  const dialog = page.getByRole('dialog', { name: '查看这一次发给千问的内容' })
  await composer.fill('我在公园看见小花。')
  await send.click()
  await dialog.getByRole('button', { name: '同意并发送这一次' }).click()
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('第一条模型回应。')
  await composer.fill('再说说这件事。')
  await send.click()
  await dialog.getByRole('button', { name: '同意并发送这一次' }).click()
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

test('a canceled slow answer cannot close a newer consent preview or appear later', async ({ page }) => {
  let calls = 0
  let oldRoute: Route | null = null
  await page.route('**/api/ai/private-chat', async (route) => {
    calls += 1
    if (calls === 1) {
      oldRoute = route
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(reply('第二句收到了，我在这里。')) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '千问聊天' }).click()
  const composer = page.getByRole('textbox', { name: '发送消息' })
  const send = page.getByRole('button', { name: '发送', exact: true })
  const dialog = page.getByRole('dialog', { name: '查看这一次发给千问的内容' })
  await composer.fill('第一句很慢。')
  await send.click()
  await dialog.getByRole('button', { name: '同意并发送这一次' }).click()
  await expect.poll(() => oldRoute !== null).toBe(true)
  await dialog.getByRole('button', { name: '仅保留本地' }).click()

  await composer.fill('第二句请继续。')
  await send.click()
  await expect(dialog).toBeVisible()
  if (oldRoute) {
    try { await oldRoute.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(reply('不应出现的旧回复。')) }) } catch { /* Aborted browser requests can reject fulfillment. */ }
  }
  await expect(dialog.locator('.product-chat-payload')).toContainText('第二句请继续。')
  await dialog.getByRole('button', { name: '同意并发送这一次' }).click()
  const chat = page.getByRole('region', { name: '对话记录' })
  await expect(chat).toContainText('第二句收到了，我在这里。')
  await expect(chat).not.toContainText('不应出现的旧回复。')
})

test('a third-turn invalid model output is explained while the correction stays local', async ({ page }) => {
  let calls = 0
  await page.route('**/api/ai/private-chat', async (route) => {
    calls += 1
    if (calls === 3) {
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({
        status: 'error', code: 'invalid_model_output', message: 'do-not-display-provider-text',
      }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(reply(calls === 1 ? '第一轮已经接住了。' : '第二轮继续聊。')) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '千问聊天' }).click()
  const composer = page.getByRole('textbox', { name: '发送消息' })
  const send = page.getByRole('button', { name: '发送', exact: true })
  const dialog = page.getByRole('dialog', { name: '查看这一次发给千问的内容' })
  for (const message of ['第一轮记录。', '第二轮记录。', '不是开心，是累。']) {
    await composer.fill(message)
    await send.click()
    await dialog.getByRole('button', { name: '同意并发送这一次' }).click()
    await expect(dialog).toHaveCount(0)
  }
  await expect(page.locator('.product-status')).toContainText('回复未通过格式与引用检查')
  await expect(page.locator('.product-status')).not.toContainText('do-not-display-provider-text')
  await expect(page.getByRole('region', { name: '对话记录' }).locator('.product-ai-reply')).toHaveCount(2)
  expect(calls).toBe(3)
  await page.getByRole('button', { name: '画册' }).click()
  await expect(page.getByRole('article', { name: '第 1 天画册页' })).toContainText('不是开心，是累。')
})
