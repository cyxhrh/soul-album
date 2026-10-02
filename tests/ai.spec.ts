import { expect, test } from './offline-model'

const generated = {
  status: 'generated', scenario: 'ahe', scenarioVersion: 'ahe-v1',
  question: '返程过零点后，今天的作息有什么变化？',
  citations: [{ id: 'ahe-today-return', quote: '返程过零点，今天起床才觉得累。' }],
  model: { provider: 'test-provider', id: 'test-model' },
  generatedAt: '2026-09-29T12:00:00Z',
}

test('AI lab sends only a synthetic scenario after a click and shows verified generated evidence', async ({ page }) => {
  const requests: string[] = []
  await page.route('**/api/ai/synthetic-question', async (route) => {
    requests.push(route.request().postData() ?? '')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(generated) })
  })

  await page.goto('/?demo=ai')
  const lab = page.getByRole('main', { name: '阿禾合成 AI 实验' })
  await expect(lab).toBeVisible()
  await expect(lab).toContainText('合成数据')
  expect(requests).toEqual([])

  await lab.getByRole('button', { name: '生成合成提问' }).click()
  await expect(lab.getByRole('status')).toContainText('模型已生成')
  await expect(lab).toContainText(generated.question)
  await expect(lab).toContainText(generated.citations[0].quote)
  expect(requests).toEqual(['{"scenario":"ahe"}'])
})

test('a literal citation match is shown with an explicit human relevance caveat', async ({ page }) => {
  const unrelatedQuestion = '今天中午的天气有什么变化？'
  await page.route('**/api/ai/synthetic-question', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...generated, question: unrelatedQuestion }),
  }))
  await page.goto('/?demo=ai')
  const lab = page.getByRole('main', { name: '阿禾合成 AI 实验' })
  await lab.getByRole('button', { name: '生成合成提问' }).click()

  await expect(lab.getByRole('status')).toContainText('引文字面匹配已校验')
  await expect(lab).toContainText(unrelatedQuestion)
  await expect(lab).toContainText('问题与引用是否相关，仍需人工判断')
  await expect(lab).not.toContainText('语义已验证')
})

test('an unconfigured model visibly falls back to a labeled preset rule', async ({ page }) => {
  await page.route('**/api/ai/synthetic-question', (route) => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ status: 'error', code: 'model_not_configured', message: 'not configured' }),
  }))
  await page.goto('/?demo=ai')
  const lab = page.getByRole('main', { name: '阿禾合成 AI 实验' })
  await lab.getByRole('button', { name: '生成合成提问' }).click()
  await expect(lab.getByRole('status')).toContainText('模型未生成 · 规则模式')
  await expect(lab.getByRole('status')).toContainText('尚未配置模型密钥')
  await expect(lab).toContainText('预设规则示例 · 不是模型输出')
  await expect(lab).not.toContainText('not configured')
})

test('network failure stays in rule mode without an automatic retry', async ({ page }) => {
  let calls = 0
  await page.route('**/api/ai/synthetic-question', (route) => {
    calls += 1
    return route.abort('failed')
  })
  await page.goto('/?demo=ai')
  const lab = page.getByRole('main', { name: '阿禾合成 AI 实验' })
  await lab.getByRole('button', { name: '生成合成提问' }).click()
  await expect(lab.getByRole('status')).toContainText('模型未生成 · 规则模式')
  await expect(lab).toContainText('预设规则示例 · 不是模型输出')
  expect(calls).toBe(1)
})

for (const result of [
  { ...generated, scenarioVersion: 'ahe-v2' },
  { ...generated, citations: [{ id: 'ahe-today-return', quote: '一段不匹配的原话。' }] },
]) {
  test(`a stale or wrong quotation cannot be displayed as model evidence: ${result.scenarioVersion} / ${result.citations[0].quote}`, async ({ page }) => {
    await page.route('**/api/ai/synthetic-question', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(result),
    }))
    await page.goto('/?demo=ai')
    const lab = page.getByRole('main', { name: '阿禾合成 AI 实验' })
    await lab.getByRole('button', { name: '生成合成提问' }).click()
    await expect(lab.getByRole('status')).toContainText('模型未生成 · 规则模式')
    await expect(lab).not.toContainText(generated.question)
    await expect(lab).not.toContainText('test-provider')
  })
}

test('reset invalidates a delayed model response', async ({ page }) => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/ai/synthetic-question', async (route) => {
    await gate
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(generated) })
  })
  await page.goto('/?demo=ai')
  const lab = page.getByRole('main', { name: '阿禾合成 AI 实验' })
  await lab.getByRole('button', { name: '生成合成提问' }).click()
  await expect(lab.getByRole('status')).toContainText('正在请求合成数据模型实验')
  await lab.getByRole('button', { name: '重置实验' }).click()
  release?.()
  await expect(lab.getByRole('status')).toContainText('尚未调用模型')
  await expect(lab).not.toContainText(generated.question)
})

test('the guided synthetic story can hand off to the independent AI lab', async ({ page }) => {
  await page.goto('/?demo=story')
  await page.getByRole('button', { name: '记录这句合成回答' }).click()
  await page.getByRole('button', { name: '记录这句合成回答' }).click()
  await page.getByRole('button', { name: '模拟第二天' }).click()
  await page.getByRole('button', { name: '记录次日合成回答' }).click()
  await page.getByRole('link', { name: '试一次阿禾合成 AI 实验' }).click()
  await expect(page.getByRole('main', { name: '阿禾合成 AI 实验' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveCount(0)
})

test('AI request cannot include an earlier free-trial answer', async ({ page }) => {
  const secret = 'PRIVATE_AI_BOUNDARY_蕨叶'
  const bodies: string[] = []
  await page.goto('/')
  await page.getByRole('textbox', { name: '发送消息' }).fill(secret)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.route('**/api/ai/synthetic-question', (route) => {
    bodies.push(route.request().postData() ?? '')
    return route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ status: 'error', code: 'model_not_configured', message: 'offline' }) })
  })
  await page.goto('/?demo=ai')
  await page.getByRole('button', { name: '生成合成提问' }).click()
  await expect(page.getByRole('status')).toContainText('模型未生成')
  expect(bodies).toEqual(['{"scenario":"ahe"}'])
  expect(bodies.join('')).not.toContain(secret)
})

test('AI lab remains usable at a phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/?demo=ai')
  await expect(page.getByRole('button', { name: '生成合成提问' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})
