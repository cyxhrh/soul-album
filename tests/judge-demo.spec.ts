import { test, expect } from '@playwright/test'
import { DEMO_ROUNDS } from '../src/features/judge/judgeScript'

test('judge flow works without APIs, updates both album faces, downloads Markdown and replays', async ({ page }) => {
  const apiCalls: string[] = []
  await page.route('**/api/**', route => { apiCalls.push(route.request().url()); return route.abort() })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?demo=judge')
  const composer = page.getByRole('textbox', { name: '预设消息' })
  await expect(composer).toHaveAttribute('readonly', '')
  await expect(page.getByText('预设示例', { exact: true })).toBeVisible()
  for (const round of DEMO_ROUNDS) {
    await expect(composer).toHaveValue(round.user)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
    await expect(page.getByRole('region', { name: '对话记录' })).toContainText(round.reply)
  }
  await page.getByRole('button', { name: '查看画册', exact: true }).click()
  await expect(page.getByRole('region', { name: '每日画册' })).toContainText('和朋友相处带来的是开心')
  await page.getByRole('button', { name: '记录背面' }).click()
  await expect(page.getByRole('region', { name: '今日肖像' })).toContainText('撤回“聚会本身耗力”的猜测')
  await page.getByText('查看原话依据', { exact: true }).click()
  await expect(page.locator('.daily-observation blockquote').last()).toHaveText(DEMO_ROUNDS[2].user)
  await page.getByText('查看 Markdown 源文件').click()
  await expect(page.locator('.judge-markdown pre')).toContainText(DEMO_ROUNDS[2].user)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 .md' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('渐知-示例-2026-10-04.md')
  expect(await download.failure()).toBeNull()
  await page.getByRole('button', { name: '09.28' }).click()
  await expect(page.getByRole('region', { name: '每日画册' })).toContainText('走到天黑，刚刚好')
  await page.getByRole('button', { name: '重新体验' }).click()
  await expect(composer).toHaveValue(DEMO_ROUNDS[0].user)
  await expect(page.locator('.product-bubble-row.user')).toHaveCount(0)
  await page.reload()
  await expect(composer).toHaveValue(DEMO_ROUNDS[0].user)
  expect(apiCalls).toEqual([])
  expect(errors).toEqual([])
})

test('mobile chat and archive fit the viewport and keep the send action accessible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/?demo=judge')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByRole('button', { name: '画册', exact: true }).click()
  await page.getByRole('button', { name: '记录背面' }).click()
  await expect(page.getByRole('region', { name: '每日画册' })).toContainText(DEMO_ROUNDS[0].reply)
  for (const button of ['记录背面', '日记正面', '前一页', '后一页']) {
    await page.getByRole('button', { name: button, exact: false }).click()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '预设消息' })).toHaveValue(DEMO_ROUNDS[1].user)
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport()
})
