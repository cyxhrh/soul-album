import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'

beforeEach(() => {
  localStorage.clear()
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({
    status: 'unavailable', model: null,
  }) })))
})
afterEach(() => { vi.useRealTimers(); cleanup(); vi.unstubAllGlobals() })

describe('Soul Album product', () => {
  it('opens directly in the conversation and keeps its three product tabs', async () => {
    render(<App />)

    expect(screen.getByRole('main', { name: '渐记产品' })).toBeVisible()
    expect(screen.getByRole('region', { name: '对话记录' })).toBeVisible()
    expect(await screen.findByLabelText('知知的开场白')).toBeVisible()
    expect(screen.queryByRole('button', { name: '千问聊天' })).not.toBeInTheDocument()
    const navigation = screen.getByRole('navigation', { name: '产品导航' })
    expect(within(navigation).getAllByRole('button').slice(0, 3).map((button) => button.textContent)).toEqual([
      '对话', '画册', '生活数据',
    ])
    expect(screen.queryByText('每天问一点，慢慢看见自己')).not.toBeInTheDocument()
  })

  it('shares a record between chat and album without losing the message draft on tab switch', async () => {
    render(<App />)
    await screen.findByText('模型未连接 · 本地记录')
    fireEvent.change(screen.getByRole('textbox', { name: '发送消息' }), {
      target: { value: '傍晚散步时看见一朵云。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByRole('region', { name: '对话记录' }))
      .toHaveTextContent('傍晚散步时看见一朵云。'))
    fireEvent.change(screen.getByRole('textbox', { name: '发送消息' }), {
      target: { value: '第二句还没写完' },
    })

    fireEvent.click(screen.getByRole('button', { name: '画册' }))
    expect(screen.getByRole('article', { name: /每日画册/ })).toHaveTextContent('傍晚散步时看见一朵云。')
    fireEvent.click(screen.getByRole('button', { name: '对话' }))
    expect(screen.getByRole('textbox', { name: '发送消息' })).toHaveValue('第二句还没写完')
  })

  it('keeps the same session when browsing data and clearing it', async () => {
    render(<App />)
    await screen.findByText('模型未连接 · 本地记录')
    fireEvent.click(screen.getByRole('button', { name: '生活数据' }))
    expect(screen.getByRole('region', { name: '生活数据' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '对话' }))
    expect(screen.getByRole('region', { name: '对话记录' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '清除本次内容' }))
    fireEvent.click(screen.getByRole('button', { name: '确认清除本机记录' }))
    expect(await screen.findByLabelText('知知的开场白')).toBeVisible()
  })

  it('shows a short typing state before a local control reply appears', async () => {
    render(<App />)
    await screen.findByText('模型未连接 · 本地记录')
    vi.useFakeTimers()
    fireEvent.change(screen.getByRole('textbox', { name: '发送消息' }), { target: { value: '换个问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    const chat = screen.getByRole('region', { name: '对话记录' })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(within(chat).getByText('知知正在输入')).toBeVisible()
    expect(within(chat).queryByText('好，换一个轻一点的问题。')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(2500))
    expect(within(chat).getByText('好，换一个轻一点的问题。')).toBeVisible()
  })

  it('keeps a typed draft when speech input is unavailable', () => {
    render(<App />)
    const composer = screen.getByRole('textbox', { name: '发送消息' })
    fireEvent.change(composer, { target: { value: '这是还没发出的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    expect(screen.getByText('当前浏览器暂不支持语音输入，请继续用文字记录。')).toBeVisible()
    expect(composer).toHaveValue('这是还没发出的草稿')
  })
})
