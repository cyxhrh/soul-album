import { expect, test } from './offline-model'

test('the product opens directly in a private conversation', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('main', { name: '渐记产品' })).toBeVisible()
  await expect(page.getByRole('region', { name: '对话记录' })).toBeVisible()
  await expect(page.getByLabel('知知的开场白')).toBeVisible()
  const nav = page.getByRole('navigation', { name: '产品导航' })
  const pages = nav.locator('.product-nav-links')
  await expect(pages.getByRole('button')).toHaveCount(3)
  await expect(pages.getByRole('button', { name: '画册' })).toBeVisible()
  await expect(pages.getByRole('button', { name: '生活数据' })).toBeVisible()
  await expect(nav.getByRole('button', { name: '清除本次内容' })).toBeVisible()
  await expect(nav.getByRole('button', { name: '详情' })).toBeVisible()
  await expect(nav.getByRole('button', { name: '对话' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('模型未连接 · 本地记录')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '发送消息' })).toBeVisible()
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '主动分享' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '跳过这一题' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '看引导演示' })).toHaveCount(0)
})

for (const width of [375, 761, 768, 772, 1440]) {
  test(`all product pages remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('region', { name: '对话记录' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.getByRole('button', { name: '画册' }).click()
    await expect(page.getByText('画册还没有第一页')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.getByRole('button', { name: '生活数据' }).click()
    await expect(page.getByRole('region', { name: '生活数据' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}

test('keyboard focus is visible and reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.keyboard.press('Tab')

  const focused = page.locator(':focus-visible')
  await expect(focused).toHaveCount(1)
  expect(await focused.evaluate((node) => getComputedStyle(node).outlineWidth)).not.toBe('0px')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto')
})
