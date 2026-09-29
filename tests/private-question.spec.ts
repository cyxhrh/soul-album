import { expect, test } from '@playwright/test'

test.use({ timezoneId: 'Asia/Shanghai' })

test('one consented excerpt can replace a rule question, then correction changes the next one', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const sent: unknown[] = []
  await page.route('**/api/ai/private-question', async (route) => {
    const request = JSON.parse(route.request().postData() ?? '{}') as {
      entry: { id: string; revision: number; quote: string }
    }
    sent.push(request)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      status: 'generated', question: '那朵黄色的小花让你想记下什么？',
      citations: [{ id: request.entry.id, quote: request.entry.quote }],
      model: { provider: 'qwen', id: 'synthetic-test-provider' },
      generatedAt: '2026-09-29T09:00:00Z',
    }) })
  })
  await page.goto('/')
  await page.getByRole('textbox', { name: '发送消息' }).fill('今天散步时看见一朵黄色的小花。')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const chat = page.getByRole('region', { name: '对话记录' })
  await expect(chat).toContainText('关于这段记录，还有什么想补充的吗？')
  expect(sent).toHaveLength(0)

  await chat.getByRole('button', { name: '让千问提议这一问' }).click()
  const gate = page.getByRole('dialog', { name: '让千问提议这一问' })
  await expect(gate).toContainText('服务方可能按其政策存储调用数据')
  await expect(gate.getByRole('textbox', { name: /实际发送的原话片段/ }))
    .toHaveValue('今天散步时看见一朵黄色的小花。')
  await page.screenshot({ path: 'test-results/private-question-gate-375.png' })
  expect(sent).toHaveLength(0)
  await gate.getByRole('button', { name: '仅保留本地问题' }).click()
  expect(sent).toHaveLength(0)
  await expect(chat).toContainText('关于这段记录，还有什么想补充的吗？')

  await chat.getByRole('button', { name: '让千问提议这一问' }).click()
  await gate.getByRole('textbox', { name: /实际发送的原话片段/ }).fill('散步时看见一朵黄色的小花')
  await gate.getByRole('button', { name: '同意并发送这一次' }).click()
  await expect(gate).toHaveCount(0)
  expect(sent).toHaveLength(1)
  expect((sent[0] as { entry: { quote: string } }).entry.quote).toBe('散步时看见一朵黄色的小花')
  await expect(chat).toContainText('那朵黄色的小花让你想记下什么？')
  await expect(chat).toContainText('千问提议')
  await chat.getByText('查看这次发送给千问的片段').click()
  await expect(chat).toContainText('“散步时看见一朵黄色的小花”')

  await chat.getByRole('button', { name: '理解偏了？补充背景' }).click()
  await chat.getByRole('textbox', { name: /哪里不准确/ }).fill('我当时只是注意到花的颜色，并没有特别的情绪。')
  await chat.getByRole('button', { name: '记下纠正并换一问' }).click()
  await expect(chat).toContainText('依据你的纠正')
  await expect(chat).toContainText('规则模式')
  await expect(chat).not.toContainText('那朵黄色的小花让你想记下什么？')
  await page.screenshot({ path: 'test-results/private-question-corrected-375.png' })
  await page.getByRole('button', { name: '画册' }).click()
  await expect(page.getByRole('article', { name: '第 1 天画册页' }))
    .toContainText('我当时只是注意到花的颜色')
})

test('a failed private request leaves the local question available without retry', async ({ page }) => {
  let calls = 0
  await page.route('**/api/ai/private-question', async (route) => {
    calls += 1
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"status":"error"}' })
  })
  await page.goto('/')
  await page.getByRole('textbox', { name: '发送消息' }).fill('今天读了一本很有趣的书。')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByRole('button', { name: '让千问提议这一问' }).click()
  await page.getByRole('dialog', { name: '让千问提议这一问' })
    .getByRole('button', { name: '同意并发送这一次' }).click()
  await expect(page.getByRole('status')).toContainText('规则问题仍在；没有自动重试')
  await expect(page.getByRole('region', { name: '对话记录' }))
    .toContainText('关于这段记录，还有什么想补充的吗？')
  expect(calls).toBe(1)
})

test('a correction made on day two appears there, and deleting its source removes it', async ({ page }) => {
  await page.route('**/api/ai/private-question', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { entry: { id: string; quote: string } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      status: 'generated', question: '那次散步是否让你格外开心？',
      citations: [{ id: body.entry.id, quote: body.entry.quote }],
      model: { provider: 'qwen', id: 'synthetic-test-provider' }, generatedAt: '2026-09-29T09:00:00Z',
    }) })
  })
  await page.goto('/')
  await page.getByRole('textbox', { name: '发送消息' }).fill('第一天只是散步路过公园，没有特别的情绪。')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByText('邀请节奏与演示日期').click()
  await page.getByRole('button', { name: '推进到第 2 天' }).click()
  await page.getByRole('button', { name: '让千问提议这一问' }).click()
  await page.getByRole('dialog', { name: '让千问提议这一问' })
    .getByRole('button', { name: '同意并发送这一次' }).click()
  await page.getByRole('button', { name: '理解偏了？补充背景' }).click()
  await page.getByRole('textbox', { name: /哪里不准确/ }).fill('我只是路过公园；不希望它把散步推断成开心。')
  await page.getByRole('button', { name: '记下纠正并换一问' }).click()
  await page.getByRole('button', { name: '画册' }).click()
  await expect(page.getByRole('article', { name: '第 2 天画册页' }))
    .toContainText('我只是路过公园')
  await expect(page.getByRole('article', { name: '第 2 天画册页' })).toContainText('1 条此前回答')
  await page.getByRole('button', { name: '查看第 1 天' }).click()
  await page.getByRole('button', { name: '删除这条原话' }).click()
  await expect(page.getByRole('main', { name: '心灵画册产品' })).not.toContainText('我只是路过公园')
  await expect(page.getByRole('button', { name: '查看第 2 天' })).toHaveCount(0)
})

test('two corrections on one day remain visible in chat and the printable album page', async ({ page }) => {
  let calls = 0
  await page.route('**/api/ai/private-question', async (route) => {
    calls += 1
    const body = JSON.parse(route.request().postData() ?? '{}') as { entry: { id: string; quote: string } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      status: 'generated',
      question: calls === 1 ? '那次散步让你觉得快乐吗？' : '读书让你感到放松吗？',
      citations: [{ id: body.entry.id, quote: body.entry.quote }],
      model: { provider: 'qwen', id: 'synthetic-test-provider' }, generatedAt: '2026-09-29T09:00:00Z',
    }) })
  })
  await page.goto('/')
  const message = page.getByRole('textbox', { name: '发送消息' })
  const send = page.getByRole('button', { name: '发送', exact: true })
  const chat = page.getByRole('region', { name: '对话记录' })
  await message.fill('早上在公园散步，看见了小花。')
  await send.click()
  await chat.getByRole('button', { name: '让千问提议这一问' }).click()
  await page.getByRole('dialog', { name: '让千问提议这一问' })
    .getByRole('button', { name: '同意并发送这一次' }).click()
  await chat.getByRole('button', { name: '理解偏了？补充背景' }).click()
  await chat.getByRole('textbox', { name: /哪里不准确/ }).fill('第一次纠正：我只是看到花，没有感到快乐。')
  await chat.getByRole('button', { name: '记下纠正并换一问' }).click()

  await message.fill('晚上我读了一本关于植物的书。')
  await send.click()
  await message.fill('再问我一题')
  await send.click()
  await chat.getByRole('button', { name: '让千问提议这一问' }).click()
  await page.getByRole('dialog', { name: '让千问提议这一问' })
    .getByRole('button', { name: '同意并发送这一次' }).click()
  await chat.getByRole('button', { name: '理解偏了？补充背景' }).click()
  await chat.getByRole('textbox', { name: /哪里不准确/ }).fill('第二次纠正：这本书让我好奇，不是放松。')
  await chat.getByRole('button', { name: '记下纠正并换一问' }).click()

  expect(calls).toBe(2)
  await expect(chat.locator('[aria-label="你补充的纠正"]')).toHaveCount(2)
  await expect(chat).toContainText('第一次纠正：我只是看到花')
  await expect(chat).toContainText('第二次纠正：这本书让我好奇')
  await page.getByRole('button', { name: '画册' }).click()
  const album = page.getByRole('article', { name: '第 1 天画册页' })
  await expect(album.getByRole('group', { name: '你的原话修正' })).toHaveCount(2)
  await expect(page.getByRole('button', { name: '查看第 1 天' })).toContainText('2 条纠正')
  const text = await album.textContent()
  expect(text!.indexOf('第一次纠正')).toBeLessThan(text!.indexOf('第二次纠正'))

  await page.getByRole('button', { name: '删除这条原话' }).first().click()
  await expect(album).not.toContainText('第一次纠正：我只是看到花')
  await expect(album).toContainText('第二次纠正：这本书让我好奇')
  await expect(page.getByRole('button', { name: '查看第 1 天' })).toContainText('1 条纠正')
  await page.getByRole('button', { name: '对话' }).click()
  await expect(chat.locator('[aria-label="你补充的纠正"]')).toHaveCount(1)
  await expect(chat).not.toContainText('第一次纠正：我只是看到花')
})
