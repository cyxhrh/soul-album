import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { DEMO_ROUNDS, PAST_RECORDS, REPLY_DELAY, demoMarkdown, todayRecord } from './judgeScript'

beforeEach(() => { vi.useFakeTimers(); window.history.replaceState(null, '', '/?demo=judge') })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); window.history.replaceState(null, '', '/') })

function sendRound() {
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  act(() => vi.advanceTimersByTime(REPLY_DELAY))
}

it('advances preset turns, preserves the original correction and updates the album', () => {
  render(<App />)
  const input = screen.getByRole('textbox', { name: '预设消息' })
  expect(input).toHaveAttribute('readonly')
  const chat = screen.getByRole('region', { name: '对话记录' })
  expect(chat).not.toHaveTextContent(DEMO_ROUNDS[0].reply)
  sendRound()
  sendRound()
  fireEvent.click(screen.getByRole('button', { name: '画册' }))
  fireEvent.click(screen.getByRole('button', { name: '记录背面' }))
  expect(screen.getByRole('region', { name: '今日肖像' })).toHaveTextContent('需要用户确认')
  fireEvent.click(screen.getByRole('button', { name: '对话' }))
  sendRound()
  sendRound()
  expect(chat).toHaveTextContent(DEMO_ROUNDS[2].user)
  expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '查看画册' }))
  expect(screen.getByRole('region', { name: '每日画册' })).toHaveTextContent('和朋友相处带来的是开心')
  fireEvent.click(screen.getByRole('button', { name: '记录背面' }))
  const portrait = screen.getByRole('region', { name: '今日肖像' })
  expect(portrait).toHaveTextContent('撤回“聚会本身耗力”的猜测')
  expect(portrait).not.toHaveTextContent('暂定猜测：聚会本身可能耗力')
  expect(screen.getByRole('region', { name: '每日画册' })).toHaveTextContent(DEMO_ROUNDS[1].reply)
})

it('blocks repeated sends and cancels a delayed reply when replayed', () => {
  render(<App />)
  const send = screen.getByRole('button', { name: '发送' })
  fireEvent.click(send)
  fireEvent.click(send)
  expect(send).toBeDisabled()
  expect(screen.getByRole('region', { name: '对话记录' }).querySelectorAll('.product-bubble-row.user')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '重新体验' }))
  act(() => vi.advanceTimersByTime(REPLY_DELAY * 2))
  expect(screen.getByRole('textbox', { name: '预设消息' })).toHaveValue(DEMO_ROUNDS[0].user)
  expect(screen.getByRole('region', { name: '对话记录' })).not.toHaveTextContent(DEMO_ROUNDS[0].reply)
  sendRound()
  expect(screen.getByRole('textbox', { name: '预设消息' })).toHaveValue(DEMO_ROUNDS[1].user)
})

it('does not access personal session storage or the model API, including replay and browsing', () => {
  const get = vi.spyOn(Storage.prototype, 'getItem')
  const set = vi.spyOn(Storage.prototype, 'setItem')
  const remove = vi.spyOn(Storage.prototype, 'removeItem')
  const fetch = vi.spyOn(globalThis, 'fetch')
  render(<App />)
  sendRound()
  fireEvent.click(screen.getByRole('button', { name: '画册' }))
  fireEvent.click(screen.getByRole('button', { name: '09.28' }))
  fireEvent.click(screen.getByRole('button', { name: '记录背面' }))
  fireEvent.click(screen.getByText('查看 Markdown 源文件'))
  fireEvent.click(screen.getByRole('button', { name: '重新体验' }))
  expect(get).not.toHaveBeenCalled()
  expect(set).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps pending turns when switching tabs and cleans up on unmount', () => {
  const view = render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  fireEvent.click(screen.getByRole('button', { name: '画册' }))
  fireEvent.click(screen.getByRole('button', { name: '记录背面' }))
  expect(screen.getByRole('region', { name: '每日画册' })).toHaveTextContent(DEMO_ROUNDS[0].user)
  expect(screen.getByRole('region', { name: '每日画册' })).not.toHaveTextContent(DEMO_ROUNDS[0].reply)
  act(() => vi.advanceTimersByTime(REPLY_DELAY))
  fireEvent.click(screen.getByRole('button', { name: '对话' }))
  expect(within(screen.getByRole('region', { name: '对话记录' })).getByText(DEMO_ROUNDS[0].reply)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('archives only arrived messages with valid user evidence and explicitly synthetic Markdown', () => {
  const today = todayRecord(4)
  for (const record of [...PAST_RECORDS, todayRecord(2), today]) {
    for (const observation of record.portrait.observations) {
      expect(observation.evidenceIds.length).toBeGreaterThan(0)
      for (const id of observation.evidenceIds) expect(record.messages.find(message => message.id === id)?.role).toBe('user')
    }
    expect(record.model).toBeUndefined()
  }
  expect(todayRecord(0).diary).toBe('')
  expect(todayRecord(2).messages).toHaveLength(5)
  expect(todayRecord(2).messages.some(message => message.text === DEMO_ROUNDS[2].user)).toBe(false)
  const markdown = demoMarkdown(today)
  expect(markdown).toContain('不代表实时模型生成或真实用户数据')
  expect(markdown).toContain(DEMO_ROUNDS[2].user)
  expect(markdown).toContain(DEMO_ROUNDS[1].reply)
  expect(markdown).toContain('暂不确认因果')
})
