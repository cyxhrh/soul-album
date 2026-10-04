import type { Page } from '@playwright/test'
import { expect, test } from './offline-model'

test.use({ timezoneId: 'Asia/Shanghai' })

async function openProduct(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('main', { name: '渐知产品' })).toBeVisible()
}

async function chat(page: Page) {
  await page.getByRole('navigation', { name: '产品导航' }).getByRole('button', { name: '对话' }).click()
}

async function album(page: Page) {
  await page.getByRole('navigation', { name: '产品导航' }).getByRole('button', { name: '画册' }).click()
  const tools = page.locator('.product-album-tools')
  if (await tools.count() && !(await tools.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await tools.locator(':scope > summary').click()
  }
  const evidence = page.locator('.daily-legacy-evidence')
  if (await evidence.count() && !(await evidence.evaluate(element => (element as HTMLDetailsElement).open))) {
    await evidence.locator(':scope > summary').click()
  }
}

async function advanceTo(page: Page, day: number) {
  await chat(page)
  const settings = page.locator('details.product-settings')
  if (!(await settings.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await settings.locator('summary').click()
  }
  await settings.getByRole('button', { name: '推进到第 ' + day + ' 天' }).click()
}

async function answer(page: Page, text: string) {
  await page.getByRole('textbox', { name: '发送消息' }).fill(text)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}

test('skipping the first question offers a different second one, including after a prior record', async ({ page }) => {
  await openProduct(page)
  const conversation = page.getByRole('region', { name: '对话记录' })
  await expect(conversation.getByLabel('知知的开场白')).toBeVisible()
  await answer(page, '换个问题')
  await expect(conversation).toContainText('今天有没有一个小瞬间想留在画册里？')
  await answer(page, '看到了阳台上的小鸟。')
  await advanceTo(page, 2)
  await expect(conversation).toContainText('关于这段记录，还有什么想补充的吗？')
  await expect(conversation).not.toContainText('你之前说“看到了阳台上的小鸟。”')
  await answer(page, '换个问题')
  await expect(conversation).toContainText('还有哪个小片段想记一笔？')
})

test('proactive sharing never makes a skipped first question repeat', async ({ page }) => {
  await openProduct(page)
  await answer(page, '今天先不聊了')
  await answer(page, '主动记录一朵云。')
  await advanceTo(page, 2)
  const conversation = page.getByRole('region', { name: '对话记录' })
  await expect(conversation).toContainText('关于这段记录，还有什么想补充的吗？')
  await expect(conversation).not.toContainText('你之前说“主动记录一朵云。”')
  await answer(page, '换个问题')
  await expect(conversation).toContainText('今天有没有一个小瞬间想留在画册里？')
})

test('control messages stay in the conversation but never create an empty diary page', async ({ page }) => {
  await openProduct(page)
  await answer(page, '换个问题')
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('换个问题')
  await answer(page, '今天先不聊了')
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('今天先不聊了')
  await album(page)
  await expect(page.locator('.daily-status')).toHaveText('原话已收录')
  await page.getByRole('button', { name: '原话与理解', exact: true }).click()
  await expect(page.locator('.daily-message-user').last()).toContainText('今天先不聊了')
})

test('a sentence containing control words is kept as the reader’s own record', async ({ page }) => {
  const original = '今天先不聊了这题，但想记下傍晚散步。'
  await openProduct(page)
  await answer(page, original)
  await album(page)
  await expect(page.getByRole('article', { name: '第 1 天画册页' })).toContainText(original)
})

test('free text on a day without an invitation still becomes a diary record', async ({ page }) => {
  await openProduct(page)
  await answer(page, '今天先不聊了')
  await advanceTo(page, 2)
  await answer(page, '今天先不聊了')
  await advanceTo(page, 8)
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('第 8 天不邀请')
  await answer(page, '没有问题也可以随手记下雨停了。')
  await album(page)
  await expect(page.getByRole('article', { name: '第 8 天画册页' }))
    .toContainText('没有问题也可以随手记下雨停了。')
})

test('offline answers stay in the browser cache and never enter model requests or console logs', async ({ page }) => {
  const sentinel = 'PRIVATE_SENTINEL_928_山茶花'
  const requests: Promise<string>[] = []
  const errors: string[] = []
  const consoleMessages: string[] = []
  page.on('request', (request) => requests.push(request.allHeaders().then((headers) =>
    request.url() + ' ' + JSON.stringify(headers) + ' ' + (request.postData() ?? ''))))
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    consoleMessages.push(message.type() + ': ' + message.text())
    if (message.type() === 'error') errors.push(message.text())
  })

  await openProduct(page)
  await answer(page, sentinel)
  await album(page)
  await expect(page.getByRole('article', { name: '第 1 天画册页' })).toContainText(sentinel)
  const storage = await page.evaluate(async () => ({
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
    indexedDbNames: (await indexedDB.databases()).map((database) => database.name ?? ''),
  }))
  expect(storage.local).toContain('jianzhi:local-session:v1')
  expect(storage.local).toContain(sentinel)
  expect(storage.session).toBe('{}')
  expect(storage.indexedDbNames).toEqual([])
  expect((await Promise.all(requests)).join('\n')).not.toContain(sentinel)
  expect(consoleMessages.join('\n')).not.toContain(sentinel)
  expect(errors).toEqual([])

  await page.reload()
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText(sentinel)
  await album(page)
  await expect(page.getByRole('article', { name: '第 1 天画册页' })).toContainText(sentinel)
  expect((await Promise.all(requests)).join('\n')).not.toContain(sentinel)
  expect(errors).toEqual([])
})

test('deleting day one withdraws a later title copied from its answer and removes it from print', async ({ page }) => {
  const secret = 'PRIVATE_TITLE_LINEAGE_山茶花'
  await openProduct(page)
  await answer(page, secret)
  await advanceTo(page, 2)
  await answer(page, '今天留下另一句。')
  await album(page)
  await page.getByRole('button', { name: '修改日页标题' }).click()
  await page.getByRole('textbox', { name: '日页标题' }).fill('回想 ' + secret)
  await page.getByRole('button', { name: '保存标题' }).click()
  await page.getByRole('button', { name: '查看第 1 天' }).click()
  await page.getByRole('button', { name: '删除这条原话' }).click()
  const confirmation = page.getByRole('dialog', { name: '确认撤下日页标题' })
  await expect(confirmation).toContainText('1 个日页标题及其修订历史')
  await confirmation.getByRole('button', { name: '取消删除' }).click()
  await expect(page.getByRole('article', { name: '第 1 天画册页' })).toContainText(secret)
  await page.getByRole('button', { name: '删除这条原话' }).click()
  await confirmation.getByRole('button', { name: '继续删除' }).click()
  await expect(page.locator('.free-status')).toContainText('1 个日页标题及其修订历史已撤下')
  await expect(page.getByRole('article', { name: '第 2 天画册页' })).not.toContainText(secret)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.daily-album:visible')).not.toContainText(secret)
})

for (const action of ['修改', '删除'] as const) {
  test(`${action} a title source closes the stale title draft before it can be saved`, async ({ page }) => {
    const secret = `PRIVATE_STALE_TITLE_${action}_山茶花`
    await openProduct(page)
    await answer(page, secret)
    await answer(page, '同一天还留下一句。')
    await album(page)
    await page.getByRole('button', { name: '修改日页标题' }).click()
    await page.getByRole('textbox', { name: '日页标题' }).fill('旧标题 ' + secret)
    await page.getByRole('button', { name: '保存标题' }).click()
    await page.getByRole('button', { name: '修改日页标题' }).click()
    await expect(page.getByRole('textbox', { name: '日页标题' })).toHaveValue('旧标题 ' + secret)

    if (action === '修改') {
      await page.getByRole('button', { name: '修改这条原话' }).first().click()
      await page.getByRole('textbox', { name: '修改原话' }).fill('已经改正的第一句。')
      await page.getByRole('button', { name: '保存修改' }).click()
    } else {
      await page.getByRole('button', { name: '删除这条原话' }).first().click()
    }
    const confirmation = page.getByRole('dialog', { name: '确认撤下日页标题' })
    await confirmation.getByRole('button', { name: `继续${action}` }).click()

    await expect(page.getByRole('textbox', { name: '日页标题' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存标题' })).toHaveCount(0)
    await expect(page.getByRole('article', { name: '第 1 天画册页' })).not.toContainText(secret)
    await page.getByRole('button', { name: '修改日页标题' }).click()
    await expect(page.getByRole('textbox', { name: '日页标题' })).toHaveValue('')
    await expect(page.getByRole('button', { name: '保存标题' })).toBeDisabled()
  })
}

test('title withdrawal traps focus and restores it on Escape', async ({ page }) => {
  await openProduct(page)
  await answer(page, '第一天的原话。')
  await advanceTo(page, 2)
  await answer(page, '第二天的原话。')
  await album(page)
  await page.getByRole('button', { name: '修改日页标题' }).click()
  await page.getByRole('textbox', { name: '日页标题' }).fill('第二天的标题')
  await page.getByRole('button', { name: '保存标题' }).click()
  await page.getByRole('button', { name: '查看第 1 天' }).click()
  await page.getByRole('button', { name: '修改这条原话' }).click()
  await page.getByRole('textbox', { name: '修改原话' }).fill('第一天修改后的原话。')
  const save = page.getByRole('button', { name: '保存修改' })
  await save.click()
  const confirmation = page.getByRole('dialog', { name: '确认撤下日页标题' })
  await expect(confirmation).toContainText('1 个日页标题及其修订历史')
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Shift+Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(confirmation).toHaveCount(0)
  await expect(save).toBeFocused()
  await expect(page.getByRole('textbox', { name: '修改原话' })).toHaveValue('第一天修改后的原话。')
})

test('title withdrawal rechecks affected days when title state changes before confirmation', async ({ page }) => {
  await openProduct(page)
  await answer(page, '第一天的原话。')
  await advanceTo(page, 2)
  await answer(page, '第二天的原话。')
  await album(page)
  await page.getByRole('button', { name: '修改日页标题' }).click()
  await page.getByRole('textbox', { name: '日页标题' }).fill('第二天的标题')
  await page.getByRole('button', { name: '保存标题' }).click()
  await page.getByRole('button', { name: '查看第 1 天' }).click()
  await page.getByRole('button', { name: '修改日页标题' }).click()
  await page.getByRole('textbox', { name: '日页标题' }).fill('第一天尚未保存的标题')
  await page.getByRole('button', { name: '修改这条原话' }).click()
  await page.getByRole('textbox', { name: '修改原话' }).fill('修改后的第一天原话。')
  await page.getByRole('button', { name: '保存修改' }).click()
  const confirmation = page.getByRole('dialog', { name: '确认撤下日页标题' })
  await expect(confirmation).toContainText('1 个日页标题及其修订历史')

  // Exercise the second preflight while the modal has made the background inert.
  await page.getByRole('button', { name: '保存标题' }).dispatchEvent('click')
  await confirmation.getByRole('button', { name: '继续修改' }).click()
  await expect(confirmation).toContainText('2 个日页标题及其修订历史')
  await expect(page.getByRole('article', { name: '第 1 天画册页' })).toContainText('第一天的原话。')
  await confirmation.getByRole('button', { name: '继续修改' }).click()
  await expect(page.locator('.free-status')).toContainText('2 个日页标题及其修订历史已撤下')
  await expect(page.getByRole('article', { name: '第 1 天画册页' })).not.toContainText('第一天尚未保存的标题')
})

test('printing warns about the exported PDF, contains focus and returns it to Print', async ({ page }) => {
  await openProduct(page)
  await answer(page, '一段用于打印的测试记录。')
  await album(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.evaluate(() => { window.print = () => {
    document.body.dataset.printCalls = String(Number(document.body.dataset.printCalls ?? '0') + 1)
  } })
  const print = page.getByRole('button', { name: '打印当前页' })
  await print.focus()
  await page.keyboard.press('Enter')
  const reminder = page.getByRole('dialog', { name: '打印前提醒' })
  await expect(reminder).toContainText('另存的 PDF 将离开本次页面内存保护')
  await expect(reminder).toContainText('自行妥善保管')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Shift+Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(reminder).toHaveCount(0)
  await expect(print).toBeFocused()
  expect(await page.locator('body').getAttribute('data-print-calls')).toBeNull()
  await page.keyboard.press('Enter')
  await reminder.getByRole('button', { name: '继续打印' }).click()
  await expect(reminder).toHaveCount(0)
  expect(await page.locator('body').getAttribute('data-print-calls')).toBe('1')
})

test('clear removes words and simulated consents; archived demo routes cannot receive them', async ({ page }) => {
  const sentinel = 'PRIVATE_CLEAR_928_蓝色纸船'
  await openProduct(page)
  await answer(page, sentinel)
  await page.getByRole('button', { name: '生活数据' }).click()
  await page.getByRole('button', { name: '开启手表步数模拟授权' }).click()
  await expect(page.getByRole('img', { name: /手表步数七日图表/ })).toBeVisible()
  await page.getByRole('button', { name: '清除本次内容' }).click()
  await page.getByRole('button', { name: '确认清除本机记录' }).click()
  await expect(page.getByRole('region', { name: '对话记录' })).not.toContainText(sentinel)
  await album(page)
  await expect(page.getByRole('heading', { name: '日子，值得慢慢翻阅。' })).toBeVisible()
  await page.getByRole('button', { name: '生活数据' }).click()
  await expect(page.getByRole('img', { name: /七日图表/ })).toHaveCount(0)
  await page.goto('/?demo=story')
  await expect(page.getByRole('main', { name: '阿禾引导剧情' })).not.toContainText(sentinel)
  await page.goto('/?demo=rhythm')
  await expect(page.getByRole('main', { name: '独立节奏场景' })).not.toContainText(sentinel)
})

test('deletion scrubs an answer from questions, album comparison and print', async ({ page }) => {
  const secret = 'PRIVATE_DELETE_928_我在旧书店停留'
  await openProduct(page)
  await answer(page, secret)
  await advanceTo(page, 2)
  await expect(page.locator('.product-bubble-row.current .product-bubble p')).not.toContainText(secret)
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('这段记录里，还有哪个细节想多说一点？')
  await expect(page.locator('.product-bubble-row.current .product-question-source'))
    .toContainText('关联第 1 天 · 「PRIVATE_DELETE_928_我在旧书店停留」')
  await answer(page, '今天也去了旧书店。')
  await expect(page.locator('.product-exchange .product-question-source'))
    .toContainText('关联第 1 天 · 「PRIVATE_DELETE_928_我在旧书店停留」')
  await album(page)
  await page.getByRole('region', { name: '前后两页摘录' }).getByLabel('较早的一条').selectOption({ index: 1 })
  await page.getByRole('region', { name: '前后两页摘录' }).getByLabel('当前页的一条').selectOption({ index: 1 })
  await expect(page.getByRole('region', { name: '前后两页摘录' })).toContainText(secret)
  await page.getByRole('button', { name: '查看第 1 天' }).click()
  await page.getByRole('button', { name: '删除这条原话' }).click()
  await page.getByRole('button', { name: '继续删除' }).click()
  await expect(page.getByRole('dialog', { name: '确认撤下日页标题' })).toHaveCount(0)
  await expect(page.getByRole('main', { name: '渐知产品' })).not.toContainText(secret)
  await expect(page.getByRole('region', { name: '前后两页摘录' })).toContainText('资料不足')
  await expect(page.getByRole('region', { name: '已回答问题' })).toContainText('引用已删除')
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('这题引用的原话已删除。')
  await expect(page.getByRole('region', { name: '对话记录' })).not.toContainText('关联第 1 天 · 「PRIVATE_DELETE_928_我在旧书店停留」')
  await album(page)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.daily-album:visible')).not.toContainText(secret)
})

test('a recorded entry shows the reader local hour', async ({ page }) => {
  await openProduct(page)
  const localHour = await page.evaluate(() => String(new Date().getHours()).padStart(2, '0'))
  await answer(page, '写下此刻。')
  await album(page)
  const recorded = await page.getByRole('article', { name: '第 1 天画册页' }).innerText()
  expect(recorded).toMatch(new RegExp('演示日期时间 \\d{4}年\\d+月\\d+日 ' + localHour + ':'))
  expect(recorded).toContain('本次录入时间')
  await page.getByRole('button', { name: '详情 ↓' }).click()
  await expect(page.getByRole('region', { name: '页面详情' })).toContainText('演示日期：')
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.daily-album:visible')).toBeVisible()
})

test('an unfinished message draft persists across tabs and explicit day advance without auto-saving', async ({ page }) => {
  await openProduct(page)
  await page.getByRole('textbox', { name: '发送消息' }).fill('只准备写在第一天的草稿。')
  await album(page)
  await chat(page)
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('只准备写在第一天的草稿。')
  await advanceTo(page, 2)
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('只准备写在第一天的草稿。')
  await album(page)
  await expect(page.getByRole('heading', { name: '日子，值得慢慢翻阅。' })).toBeVisible()
  await chat(page)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await album(page)
  await expect(page.getByRole('article', { name: '第 2 天画册页' })).toContainText('只准备写在第一天的草稿。')
  await expect(page.getByRole('navigation', { name: '有记录日期' }).getByRole('button')).toHaveCount(1)
})
