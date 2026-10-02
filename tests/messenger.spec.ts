import { expect, test } from './offline-model'
import type { Page } from '@playwright/test'

async function installVoiceConversationFixture(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const context = new AudioContext()
        await context.resume()
        const oscillator = context.createOscillator()
        const destination = context.createMediaStreamDestination()
        oscillator.connect(destination)
        oscillator.start()
        const track = destination.stream.getAudioTracks()[0]
        const stop = track.stop.bind(track)
        track.stop = () => { stop(); oscillator.stop(); void context.close() }
        return destination.stream
      },
    })
    class RecognizerFixture {
      onmessage: ((event: { data: { type: string; text?: string } }) => void) | null = null
      onerror = null
      timer: ReturnType<typeof setTimeout> | undefined
      postMessage() {
        this.onmessage?.({ data: { type: 'transcribing' } })
        this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'result', text: '今天和朋友散步很开心。' } }), 300)
      }
      terminate() { clearTimeout(this.timer) }
    }
    Object.defineProperty(window, 'Worker', { value: RecognizerFixture })
  })
}

test('the contact header keeps model status, voice input and dismissible settings', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '慢慢', exact: true })).toBeVisible()
  await expect(page.getByText('AI 记录伙伴', { exact: true })).toBeVisible()
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

test('companions switch without changing the draft, and the phone opens a separate call screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  await page.getByRole('textbox', { name: '发送消息' }).fill('尚未发送的草稿')
  for (const [name, label] of [['小笺', '女性'], ['知墨', '男性'], ['慢慢', '中性']]) {
    await page.getByLabel('选择伙伴').click()
    const choice = page.getByRole('button', { name: `${name}，${label}形象` })
    await expect(choice.locator('span')).toHaveCount(0)
    expect(await choice.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    await choice.click()
    await expect(page.locator('.messenger-contact h1')).toHaveText(name)
  }
  await page.getByRole('button', { name: '语音对话' }).click()
  const call = page.getByRole('region', { name: '渐知语音通话' })
  await expect(call).toBeVisible()
  await expect(call.locator('.product-call-portrait img')).toHaveAttribute('alt', /慢慢/)
  await expect(page.getByRole('navigation', { name: '产品导航' })).toBeHidden()
  await expect(page.getByRole('region', { name: '对话记录' })).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  const bounds = (await call.boundingBox())!
  expect(bounds.width).toBe(320)
  expect(bounds.height).toBe(568)
  await expect(page.getByRole('button', { name: '开始语音对话聆听' })).toBeInViewport()
  await page.getByRole('button', { name: '退出语音通话' }).click()
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('尚未发送的草稿')
  await expect(page.getByRole('button', { name: '语音对话' })).toBeFocused()
})

test('a call reveals local transcription, sends it through the existing chat and shows the partner reply', async ({ page }) => {
  await installVoiceConversationFixture(page)
  await page.goto('/')
  await page.getByRole('textbox', { name: '发送消息' }).fill('保留文字草稿')
  await page.getByLabel('选择伙伴').click()
  await page.getByRole('button', { name: '小笺，女性形象' }).click()
  await page.getByRole('button', { name: '语音对话' }).click()
  await page.getByRole('button', { name: '开始语音对话聆听' }).click()
  await expect(page.getByRole('heading', { name: '聆听中' })).toBeVisible()
  await page.waitForTimeout(450)
  await page.getByRole('button', { name: '说完了，转写并发送' }).click()
  await expect(page.getByLabel('本次语音文字')).toContainText('今天')
  await expect(page.locator('.product-bubble-row.user')).toHaveCount(0)
  await expect(page.locator('.product-bubble-row.user')).toHaveCount(1)
  await expect(page.locator('.product-call-reply')).toContainText('小笺正在输入')
  await expect(page.locator('.product-call-reply')).not.toContainText('小笺正在输入')
  await page.getByRole('button', { name: '退出语音通话' }).click()
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('保留文字草稿')
  await expect(page.getByRole('region', { name: '对话记录' })).toContainText('今天和朋友散步很开心。')
})

test('leaving a call while microphone permission is pending releases any late stream', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as Window & { grantVoice?: () => void; voiceTrack?: MediaStreamTrack }
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => new Promise<MediaStream>((resolve) => {
        state.grantVoice = () => {
          const context = new AudioContext()
          const stream = context.createMediaStreamDestination().stream
          state.voiceTrack = stream.getAudioTracks()[0]
          resolve(stream)
          void context.close()
        }
      }),
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '语音对话' }).click()
  await page.getByRole('button', { name: '开始语音对话聆听' }).click()
  await page.getByRole('button', { name: '退出语音通话' }).click()
  await page.evaluate(() => (window as Window & { grantVoice: () => void }).grantVoice())
  await expect.poll(() => page.evaluate(() => (window as Window & { voiceTrack: MediaStreamTrack }).voiceTrack.readyState)).toBe('ended')
  await expect(page.getByRole('textbox', { name: '发送消息' })).toBeVisible()
  await expect(page.locator('.product-bubble-row.user')).toHaveCount(0)
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
