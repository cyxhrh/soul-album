import { expect, test } from '@playwright/test'

test('product and archived demo routes remain usable at phone and desktop widths with reduced motion', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.emulateMedia({ reducedMotion: 'reduce' })

  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const entrance of [
      { path: '/?demo=story', main: '阿禾引导剧情', label: '合成演示' },
      { path: '/?demo=rhythm', main: '独立节奏场景', label: '模拟节奏变化' },
      { path: '/', main: '心灵画册产品', label: '今天有什么想记下的？' },
    ]) {
      await page.goto(entrance.path)
      const main = page.getByRole('main', { name: entrance.main })
      await expect(main).toBeVisible()
      await expect(main.getByText(entrance.label, { exact: true }).first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.keyboard.press('Tab')
      const focused = page.locator(':focus-visible')
      await expect(focused).toHaveCount(1)
      expect(await focused.evaluate((node) => getComputedStyle(node).outlineWidth)).not.toBe('0px')
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto')
    }
  }
  expect(errors).toEqual([])
})

async function openStory(page: import('@playwright/test').Page) {
  await page.goto('/?demo=story')
  await expect(page.getByText('合成演示', { exact: true })).toBeVisible()
}

async function answerToday(page: import('@playwright/test').Page) {
  await openStory(page)
  await page.getByRole('button', { name: '记录这句合成回答' }).click()
  await page.getByRole('button', { name: '记录这句合成回答' }).click()
}

test('guided questions appear one at a time and one answer already makes a page', async ({ page }) => {
  await openStory(page)

  await expect(page.getByRole('heading', { name: '今天最想记住什么？' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '什么时候开始觉得累？' })).toHaveCount(0)
  await expect(page.getByText('这一天还没有回答')).toBeVisible()

  await page.getByRole('button', { name: '记录这句合成回答' }).click()
  await expect(page.getByRole('heading', { name: '什么时候开始觉得累？' })).toBeVisible()
  const pageToday = page.getByRole('article', { name: '2026年9月23日画册页' })
  await expect(pageToday).toContainText('昨晚见了朋友，聊天很开心')
  await expect(pageToday).toContainText('用户感受')
  await expect(pageToday).toContainText('发生 2026年9月22日 19:30 · 记录 2026年9月23日 20:14')
  await expect(pageToday).not.toContainText('返程过零点')

  await page.getByRole('button', { name: '记录这句合成回答' }).click()
  await expect(page.getByRole('heading', { name: '什么时候开始觉得累？' })).toHaveCount(0)
  await expect(pageToday).toContainText('返程过零点')
  await expect(pageToday).toContainText('自述事实')
  await expect(page.getByText('今天的两问已结束')).toBeVisible()
})

test('finished guided story opens a fresh rule-based free trial, even after looking back', async ({ page }) => {
  await answerToday(page)
  await page.getByRole('button', { name: '不是这样' }).click()
  await page.getByRole('button', { name: '模拟第二天' }).click()
  await page.getByRole('button', { name: '记录次日合成回答' }).click()
  await expect(page.getByRole('button', { name: '进入自由每日问答' })).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.screenshot({ path: 'test-results/guided-handoff-375.png', fullPage: true })
  await page.getByRole('button', { name: '回到第一天' }).click()
  await expect(page.getByRole('button', { name: '进入自由每日问答' })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回首页' })).toBeVisible()

  await page.getByRole('button', { name: '进入自由每日问答' }).click()
  const free = page.getByRole('main', { name: '心灵画册产品' })
  await expect(free).toBeVisible()
  await expect(free.getByRole('region', { name: '对话记录' })).toBeVisible()
  await expect(free.getByRole('article', { name: '第 1 天画册页' })).toHaveCount(0)
  await expect(free.getByText('第 1 天 · 第 1 题')).toBeVisible()
  await expect(free).not.toContainText('昨晚见了朋友，聊天很开心')
  await expect(free).not.toContainText('和朋友相处让我开心，可能是返程太晚')
  await expect(free).not.toContainText('阿禾')
})

test('correction replaces the old interpretation and changes tomorrow’s question', async ({ page }) => {
  await answerToday(page)
  const story = page.getByRole('main', { name: '阿禾引导剧情' })
  await expect(story).toContainText('也许聚会让你耗力')
  await page.getByRole('button', { name: '查看观察依据' }).click()
  const evidence = page.getByRole('region', { name: '观察依据' })
  await expect(evidence).toContainText('2026年9月15日')
  await expect(evidence).toContainText('和朋友吃饭很开心')
  await expect(evidence).toContainText('2026年9月19日')
  await expect(evidence).toContainText('活动结束后返程过零点')
  await expect(evidence).toContainText('发生：2026年9月22日 19:30 · 归档页：2026年9月23日')
  await expect(page.getByRole('article', { name: '2026年9月23日画册页' })).toContainText('仍不确定')

  const before = await page.getByTestId('tomorrow-question').innerText()
  await page.getByRole('button', { name: '不是这样' }).click()
  await expect(story).not.toContainText('也许聚会让你耗力')
  const correction = page.getByRole('group', { name: '阿禾原话修正' })
  const agentReading = page.getByRole('group', { name: 'Agent 新的暂定观察' })
  await expect(correction).toContainText('和朋友相处让我开心，可能是返程太晚')
  await expect(correction).not.toContainText('两次晚归后')
  await expect(agentReading).toContainText('两次晚归后，次日提到疲惫；原因仍需更多记录')
  await expect(page.getByTestId('tomorrow-question')).toHaveText('你补充说“和朋友相处让我开心，可能是返程太晚”。今天的作息有什么不同？')
  expect(await page.getByTestId('tomorrow-question').innerText()).not.toBe(before)

  await page.getByRole('button', { name: '模拟第二天' }).click()
  await expect(page.getByRole('heading', { name: /返程太晚/ })).toBeVisible()
  await expect(page.getByText('这一天还没有回答')).toBeVisible()
  await page.getByRole('button', { name: '记录次日合成回答' }).click()
  const comparison = page.getByRole('region', { name: '两日对照' })
  await expect(comparison).toContainText('2026年9月23日')
  await expect(comparison).toContainText('2026年9月24日')
  await expect(comparison).toContainText('返程过零点')
  await expect(comparison).toContainText('今天没有晚归')
  await page.getByRole('button', { name: '回到第一天' }).click()
  await expect(page.getByText('次日已记录')).toBeVisible()
  await expect(page.getByTestId('tomorrow-question')).toHaveCount(0)
})

test('print media keeps only the selected day with sources and correction status', async ({ page }) => {
  await answerToday(page)
  await page.getByRole('button', { name: '不是这样' }).click()
  await page.getByRole('button', { name: '模拟第二天' }).click()
  await page.getByRole('button', { name: '记录次日合成回答' }).click()
  await page.getByRole('button', { name: '9月23日' }).click()
  await page.emulateMedia({ media: 'print' })

  const printed = page.locator('.print-page:visible')
  await expect(printed).toHaveCount(1)
  await expect(printed).toContainText('2026年9月23日')
  await expect(printed).toContainText('来源：阿禾的合成回答')
  await expect(printed).toContainText('修正第 2 版')
  await expect(printed.getByRole('group', { name: '阿禾原话修正' })).toContainText('和朋友相处让我开心，可能是返程太晚')
  await expect(printed.getByRole('group', { name: 'Agent 新的暂定观察' })).toContainText('两次晚归后，次日提到疲惫')
  await expect(printed).not.toContainText('今天没有晚归')
  await expect(printed).not.toContainText('活动结束后返程过零点')
  await expect(page.getByRole('navigation', { name: '日期目录' })).toBeHidden()
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(255, 255, 255)')
  await page.screenshot({ path: 'test-results/guided-print.png', fullPage: true })
  await page.pdf({ path: 'test-results/guided-page.pdf', format: 'A4', printBackground: true })
})

test('an unanswered day is named as having no record in the guided story directory', async ({ page }) => {
  await openStory(page)
  await expect(page.getByRole('button', { name: '9月24日 · 无记录' })).toBeVisible()
  await page.getByRole('button', { name: '9月24日 · 无记录' }).click()
  await expect(page.getByText('这一天还没有回答')).toBeVisible()
  await expect(page.getByRole('article', { name: '2026年9月24日画册页' })).toHaveCount(0)
})

test('synthetic photo and steps can be granted separately, then disappear from the album and print on revocation', async ({ page }) => {
  await answerToday(page)
  const album = page.getByRole('article', { name: '2026年9月23日画册页' })
  await expect(album).not.toContainText('4,200 步')
  await page.getByRole('button', { name: '使用合成照片' }).click()
  await expect(album).toContainText('雨后街角')
  await expect(album).not.toContainText('4,200 步')
  await page.getByRole('button', { name: '使用模拟步数' }).click()
  await expect(album).toContainText('4,200 步')
  await expect(album).toContainText('模拟手表')
  await expect(album).not.toContainText('心情很好')
  await expect(album.getByRole('img', { name: '合成照片：雨后街角' })).toBeVisible()
  await page.screenshot({ path: 'test-results/sources-granted-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.screenshot({ path: 'test-results/sources-granted-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.print-page:visible')).toContainText('雨后街角')
  await expect(page.locator('.print-page:visible')).toContainText('4,200 步')
  await page.pdf({ path: 'test-results/sources-granted.pdf', format: 'A4', printBackground: true })
  await page.emulateMedia({ media: 'screen' })
  await page.getByRole('button', { name: '撤回合成照片' }).click()
  await expect(album).not.toContainText('雨后街角')
  await expect(album).toContainText('4,200 步')
  await page.getByRole('button', { name: '撤回模拟步数' }).click()
  await expect(album).not.toContainText('4,200 步')
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.print-page:visible')).not.toContainText('4,200 步')
  await expect(page.locator('.print-page:visible')).not.toContainText('雨后街角')
  await page.pdf({ path: 'test-results/sources-revoked.pdf', format: 'A4', printBackground: true })
})

test('two shown rounds without answers lower the independent rhythm demo to weekly with day 9 next', async ({ page }) => {
  await page.goto('/?demo=rhythm')
  await expect(page.getByRole('heading', { name: '模拟节奏变化' })).toBeVisible()
  await expect(page.getByText('第 1 天 · 第 1 题')).toBeVisible()
  await page.getByRole('button', { name: '跳过这一题' }).click()
  await expect(page.getByText('第 1 天 · 第 2 题')).toBeVisible()
  await page.getByRole('button', { name: '跳过这一题' }).click()
  await expect(page.getByText('第 2 天 · 第 1 题')).toBeVisible()
  await page.getByRole('button', { name: '今天不想答' }).click()
  await expect(page.getByText('节奏已调为每周，你想聊随时来')).toBeVisible()
  await expect(page.getByRole('combobox', { name: '手动调整节奏' })).toHaveValue('weekly')
  await expect(page.getByText('第 8 天不邀请')).toBeVisible()
  await page.screenshot({ path: 'test-results/rhythm-weekly-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.screenshot({ path: 'test-results/rhythm-weekly-mobile.png', fullPage: true })
  await page.getByRole('button', { name: '查看第 9 天' }).click()
  await expect(page.getByText('第 9 天 · 第 1 题')).toBeVisible()
  await expect(page.getByText('第 9 天 · 第 2 题')).toHaveCount(0)
})

test('rhythm controls allow a next-day manual change and pause without catch-up', async ({ page }) => {
  await page.goto('/?demo=rhythm')
  await page.getByRole('combobox', { name: '手动调整节奏' }).selectOption('weekly')
  await page.getByRole('button', { name: '应用节奏' }).click()
  await expect(page.getByText('新节奏从第 2 天生效')).toBeVisible()
  await page.getByRole('button', { name: '暂停邀请' }).click()
  await expect(page.getByText('邀请已暂停')).toBeVisible()
  await page.getByRole('button', { name: '模拟来到第 8 天' }).click()
  await expect(page.getByText('第 8 天不邀请')).toBeVisible()
  await page.getByRole('button', { name: '恢复邀请' }).click()
  await expect(page.getByText('下次邀请在第 9 天')).toBeVisible()
  await page.getByRole('button', { name: '查看第 9 天' }).click()
  await expect(page.getByText('第 9 天 · 第 1 题')).toBeVisible()
})

test('resuming manual rhythm schedules no invitation while daily rhythm still names the next day', async ({ page }) => {
  await page.goto('/?demo=rhythm')
  await page.getByRole('combobox', { name: '手动调整节奏' }).selectOption('manual')
  await page.getByRole('button', { name: '应用节奏' }).click()
  await page.getByRole('button', { name: '暂停邀请' }).click()
  await page.getByRole('button', { name: '模拟来到第 8 天' }).click()
  await page.getByRole('button', { name: '恢复邀请' }).click()
  await expect(page.getByText('邀请已恢复；目前只在你主动分享时记录。')).toBeVisible()
  await expect(page.getByText('下次邀请在第 null 天')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /查看第 \d+ 天/ })).toHaveCount(0)

  await page.goto('/?demo=rhythm')
  await page.getByRole('button', { name: '暂停邀请' }).click()
  await page.getByRole('button', { name: '恢复邀请' }).click()
  await expect(page.getByText('下次邀请在第 2 天')).toBeVisible()
})

test('jumping from a displayed day settles only that day, not the unseen dates', async ({ page }) => {
  await page.goto('/?demo=rhythm')
  await page.getByRole('button', { name: '模拟来到第 8 天' }).click()
  await expect(page.getByText('第 8 天 · 第 1 题')).toBeVisible()
  await page.getByRole('button', { name: '今天不想答' }).click()
  await expect(page.getByText('节奏已调为每周，你想聊随时来')).toBeVisible()
  await expect(page.getByRole('combobox', { name: '手动调整节奏' })).toHaveValue('weekly')
  await expect(page.getByRole('button', { name: '查看第 15 天' })).toBeVisible()
})

test('granting a synthetic photo again gives the fresh consent a later display time', async ({ page }) => {
  await answerToday(page)
  await page.getByRole('button', { name: '使用合成照片' }).click()
  const source = page.getByRole('region', { name: '已授权补充资料' })
  const first = (await source.innerText()).match(/更新 (\d{4}年\d+月\d+日 \d{2}:\d{2})/)?.[1]
  expect(first).toBeTruthy()
  await page.getByRole('button', { name: '撤回合成照片' }).click()
  await page.getByRole('button', { name: '使用合成照片' }).click()
  const second = (await source.innerText()).match(/更新 (\d{4}年\d+月\d+日 \d{2}:\d{2})/)?.[1]
  expect(second).toBeTruthy()
  expect(second! > first!).toBe(true)
})

async function openFree(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.getByRole('main', { name: '心灵画册产品' })).toBeVisible()
  await expect(page.getByRole('region', { name: '对话记录' })).toBeVisible()
}

async function openChat(page: import('@playwright/test').Page) {
  await page.getByRole('navigation', { name: '产品导航' }).getByRole('button', { name: '对话' }).click()
}

async function openAlbum(page: import('@playwright/test').Page) {
  await page.getByRole('navigation', { name: '产品导航' }).getByRole('button', { name: '画册' }).click()
  const tools = page.locator('.product-album-tools')
  if (await tools.count() && !(await tools.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await tools.locator('summary').click()
  }
}

async function advanceTo(page: import('@playwright/test').Page, day: number) {
  await openChat(page)
  const settings = page.locator('details.product-settings')
  if (!(await settings.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await settings.locator('summary').click()
  }
  await settings.getByRole('button', { name: '推进到第 ' + day + ' 天' }).click()
}

async function send(page: import('@playwright/test').Page, text: string) {
  await page.getByRole('textbox', { name: '发送消息' }).fill(text)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}

test('two chat questions create a diary page, with a third question only by invitation', async ({ page }) => {
  await openFree(page)
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('第 1 天 · 第 1 题')
  await openAlbum(page)
  await expect(page.getByText('画册还没有第一页')).toBeVisible()
  await openChat(page)

  await send(page, '今天在河边散步。')
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('第 1 天 · 第 2 题')
  await openAlbum(page)
  await expect(page.getByRole('article', { name: '第 1 天画册页' })).toContainText('今天在河边散步。')
  await openChat(page)
  await send(page, '换个问题')
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('今天的邀请已结束')
  await send(page, '再问我一个问题')
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('第 1 天 · 主动第 3 题')
  await send(page, '还想补充一件小事。')
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('今天的邀请已结束')
  await openAlbum(page)
  const diary = page.getByRole('article', { name: '第 1 天画册页' })
  await expect(diary).toContainText('还想补充一件小事。')
  await expect(diary).not.toContainText('换个问题')
  await expect(diary).not.toContainText('再问我一个问题')
})

test('editing a cited answer updates the next question and keeps the two-day comparison neutral', async ({ page }) => {
  await openFree(page)
  await send(page, '我看见了紫色的晚霞。')
  await advanceTo(page, 2)
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('这段记录里，还有哪个细节想多说一点？')
  await expect(page.locator('.product-bubble-row.current .product-question-source'))
    .toHaveText('关联第 1 天 · 「我看见了紫色的晚霞。」')
  await expect(page.getByRole('region', { name: '对话记录' })).not.toContainText('你之前说“我看见了紫色的晚霞。”')
  await openAlbum(page)
  await page.getByRole('button', { name: '查看第 1 天' }).click()
  await page.getByRole('button', { name: '修改这条原话' }).click()
  await page.getByRole('textbox', { name: '修改原话' }).fill('我看见了金色的晚霞。')
  await page.getByRole('button', { name: '保存修改' }).click()
  await openChat(page)
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('关于这段记录，还有什么想补充的吗？')
  await expect(page.locator('.product-bubble-row.current .product-question-source'))
    .toHaveText('关联第 1 天 · 「我看见了金色的晚霞。」')
  await expect(page.getByRole('region', { name: '对话记录' })).not.toContainText('关联第 1 天 · 「我看见了紫色的晚霞。」')
  await expect(page.getByRole('region', { name: '对话记录' })).not.toContainText('你之前说“我看见了金色的晚霞。”')
  await send(page, '今天看见了橙色的晚霞。')
  await openAlbum(page)
  const comparison = page.getByRole('region', { name: '前后两页摘录' })
  await comparison.getByLabel('较早的一条').selectOption({ index: 1 })
  await comparison.getByLabel('当前页的一条').selectOption({ index: 1 })
  await expect(comparison).toContainText('金色的晚霞')
  await expect(comparison).toContainText('橙色的晚霞')
  await expect(comparison).toContainText('亲手选择两条原话并列')
  await expect(comparison).not.toContainText('情绪')
  await page.emulateMedia({ media: 'print' })
  const printed = page.locator('.print-page:visible')
  await expect(printed).toHaveCount(1)
  await expect(printed).toContainText('橙色的晚霞')
  await expect(printed).not.toContainText('金色的晚霞')
})

test('two unanswered invitation days lower cadence without invitations on skipped dates', async ({ page }) => {
  await openFree(page)
  await send(page, '今天先不聊了')
  await advanceTo(page, 2)
  await send(page, '今天先不聊了')
  await expect(page.getByRole('status')).toContainText('节奏已调为每周')
  await page.locator('details.product-settings > summary').click()
  await expect(page.getByRole('combobox', { name: '手动调整节奏' })).toHaveValue('weekly')
  await advanceTo(page, 8)
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('第 8 天不邀请')
  await advanceTo(page, 9)
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('第 9 天 · 第 1 题')
  await expect(page.getByRole('region', { name: '对话记录' })).not.toContainText('第 9 天 · 第 2 题')
})

test('declining an optional third question does not count as a missed invitation day', async ({ page }) => {
  await openFree(page)
  await send(page, '第一件事已经记下。')
  await send(page, '第二件事也记下。')
  await send(page, '再问我一个问题')
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('第 1 天 · 主动第 3 题')
  await send(page, '今天先不聊了')
  await advanceTo(page, 2)
  await send(page, '今天先不聊了')
  await page.locator('details.product-settings > summary').click()
  await expect(page.getByRole('combobox', { name: '手动调整节奏' })).toHaveValue('daily')
  await expect(page.getByRole('status')).not.toContainText('节奏已调为每周')
})

test('a private album title can be revised and only its current text prints', async ({ page }) => {
  await openFree(page)
  await send(page, '今天读完一本短篇小说。')
  await openAlbum(page)
  await page.getByRole('button', { name: '修改日页标题' }).click()
  await page.getByRole('textbox', { name: '日页标题' }).fill('读完故事的晚上')
  await page.getByRole('button', { name: '保存标题' }).click()
  const album = page.getByRole('article', { name: '第 1 天画册页' })
  await expect(album.getByRole('heading', { name: '读完故事的晚上' })).toBeVisible()
  await expect(album).toContainText('标题修订第 1 版')
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.print-page:visible')).toContainText('读完故事的晚上')
  await expect(page.locator('.print-page:visible')).toContainText('今天读完一本短篇小说。')
})

test('unrelated proactive notes do not claim a shared comparison topic', async ({ page }) => {
  await openFree(page)
  await send(page, '今天先不聊了')
  await send(page, '我给阳台上的花浇了水。')
  await advanceTo(page, 2)
  await send(page, '今天先不聊了')
  await send(page, '今天处理了公交卡。')
  await openAlbum(page)
  await expect(page.getByRole('region', { name: '前后两页摘录' })).toContainText('请选择两条原话')
})

test('long private text wraps in chat, album and print at phone width', async ({ page }) => {
  const longWord = 'PRIVATEUNBROKEN928'.repeat(44)
  await page.setViewportSize({ width: 375, height: 812 })
  await openFree(page)
  await send(page, longWord)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 375)).toBe(true)
  await openAlbum(page)
  const album = page.getByRole('article', { name: '第 1 天画册页' })
  expect(await album.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.emulateMedia({ media: 'print' })
  expect(await album.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})
