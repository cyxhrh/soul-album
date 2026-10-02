import { expect, test } from './offline-model'

test('the contact header keeps model status, voice input and dismissible settings', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '知知', exact: true })).toBeVisible()
  await expect(page.getByText('AI 记录伙伴', { exact: true })).toBeVisible()
  const avatars = page.locator('.product-avatar:not(.product-avatar-self) img')
  await expect(page.locator('.messenger-contact img')).toBeVisible()
  await expect(page.getByLabel('知知的开场白').locator('img')).toBeVisible()
  await expect.poll(() => avatars.evaluateAll(images => images.every(image =>
    (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
  ))).toBe(true)
  await expect(page.locator('[aria-label="模型状态"]')).toContainText('模型未连接 · 本地记录')
  await expect(page.getByRole('button', { name: '开始语音输入' })).toBeVisible()
  const settings = page.locator('.product-settings > summary')
  await settings.click()
  await expect(page.getByRole('combobox', { name: '手动调整节奏' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeFocused()
  await expect(page.locator('.product-settings')).not.toHaveAttribute('open', '')
  await settings.click()
  await page.getByRole('textbox', { name: '发送消息' }).click()
  await expect(page.locator('.product-settings')).not.toHaveAttribute('open', '')
})

test('a multiline draft grows, survives a tab change and resets after sending', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  const input = page.getByRole('textbox', { name: '发送消息' })
  const startHeight = (await input.boundingBox())!.height
  const draft = Array.from({ length: 8 }, (_, index) => `未发出的第 ${index + 1} 行`).join('\n')
  await input.fill(draft)
  expect((await input.boundingBox())!.height).toBeGreaterThan(startHeight)
  await page.getByRole('button', { name: '画册', exact: true }).click()
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await expect(input).toHaveValue(draft)
  const composer = (await page.locator('.product-composer').boundingBox())!
  const nav = (await page.getByRole('navigation', { name: '产品导航' }).boundingBox())!
  expect(composer.y + composer.height).toBeLessThanOrEqual(nav.y)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(input).toHaveValue('')
  await expect(input).toBeFocused()
  expect((await input.boundingBox())!.height).toBe(startHeight)
})
