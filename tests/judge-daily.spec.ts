import { test, expect } from '@playwright/test'
import { DEMO_ROUNDS } from '../src/features/judge/judgeScript'

test('daily samples preserve a reply in progress and link back to the current diary without APIs', async ({ page }) => {
  const apiCalls: string[] = []
  const errors: string[] = []
  await page.route('**/api/**', route => { apiCalls.push(route.request().url()); return route.abort() })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?demo=judge')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByRole('button', { name: '日常', exact: true }).click()
  const daily = page.getByRole('region', { name: '日常生活记录' })
  await expect(daily).toBeVisible()
  await expect(page.getByRole('button', { name: '日常', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(daily).toContainText('2,360')
  await expect(daily).toContainText('15:00')
  await daily.getByRole('button', { name: '查看2026年10月3日的日常', exact: true }).click()
  await expect(daily).toContainText('8,926')
  await daily.getByRole('button', { name: '查看消费明细', exact: true }).click()
  await expect(daily.getByRole('table').first()).toBeVisible()
  await daily.getByText('数据来源', { exact: true }).click()
  await daily.getByLabel('显示消费示例').uncheck()
  await expect(daily.getByRole('table')).toHaveCount(0)
  await daily.getByRole('button', { name: '回到对话', exact: true }).click()
  const chat = page.getByRole('region', { name: '对话记录' })
  await expect(chat.getByText(DEMO_ROUNDS[0].reply, { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '预设消息' })).toHaveValue(DEMO_ROUNDS[1].user)
  await expect(chat.locator('.product-bubble-row.user')).toHaveCount(1)
  await page.getByRole('button', { name: '日常', exact: true }).click()
  await expect(daily.getByLabel('显示消费示例')).not.toBeChecked()
  await daily.getByRole('button', { name: '翻开今天的画册', exact: true }).click()
  await expect(page.getByRole('region', { name: '每日画册' })).toContainText('好久没这么开心了')
  await page.getByRole('button', { name: '重新体验', exact: true }).click()
  await page.getByRole('button', { name: '日常', exact: true }).click()
  await page.getByText('数据来源', { exact: true }).click()
  await expect(daily.getByLabel('显示消费示例')).toBeChecked()
  expect(apiCalls).toEqual([])
  expect(errors).toEqual([])
})

for (const width of [320, 375]) {
  test(`daily records and three navigation entries fit a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 })
    await page.goto('/?demo=judge')
    for (const name of ['对话', '画册', '日常']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeInViewport()
    }
    await page.getByRole('button', { name: '日常', exact: true }).click()
    const daily = page.getByRole('region', { name: '日常生活记录' })
    await daily.getByRole('button', { name: '查看心率明细', exact: true }).click()
    await expect(daily.getByRole('table').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await daily.getByText('数据来源', { exact: true }).click()
    for (const name of ['显示步数示例', '显示心率示例', '显示消费示例']) await daily.getByLabel(name).uncheck()
    await expect(daily.getByRole('table')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await daily.getByRole('button', { name: '回到对话', exact: true }).click()
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport()
  })
}
