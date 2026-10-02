import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import DailyAlbum from './DailyAlbum'
import { createDailyRecord } from './dailyRecord'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const message = { id: 'm1', role: 'user' as const, text: '今天试着把项目讲给朋友听。', recordedAt: '2026-09-30T09:00:00Z' }

it('keeps a full long original on the reverse without calling a model to flip', () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const record = createDailyRecord('2026-09-30', [{ ...message, text: '长'.repeat(900) + '最后其实很开心。' }])
  render(<DailyAlbum record={record} onSave={vi.fn()} modelReady />)
  fireEvent.click(screen.getByRole('button', { name: '记录背面' }))
  expect(screen.getByText(/最后其实很开心/)).toBeVisible()
  expect(fetcher).not.toHaveBeenCalled()
})

it('lets the user edit the front without erasing the conversation', () => {
  const save = vi.fn()
  const record = createDailyRecord('2026-09-30', [message])
  render(<DailyAlbum record={record} onSave={save} modelReady={false} />)
  fireEvent.click(screen.getByRole('button', { name: '编辑日记' }))
  fireEvent.change(screen.getByLabelText('日记正文'), { target: { value: '今天终于把想法讲了出来。' } })
  fireEvent.click(screen.getByRole('button', { name: '保存日记' }))
  expect(save.mock.calls[0][0].diary).toBe('今天终于把想法讲了出来。')
  expect(save.mock.calls[0][0].messages).toEqual([message])
})

it('does not apply a late model response to changed source records', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve })))
  const save = vi.fn()
  const record = createDailyRecord('2026-09-30', [message])
  const view = render(<DailyAlbum record={record} onSave={save} modelReady />)
  fireEvent.click(screen.getByRole('button', { name: '整理今天' }))
  view.rerender(<DailyAlbum record={createDailyRecord('2026-09-30', [{ ...message, text: '内容已经更正。' }])} onSave={save} modelReady />)
  finish(new Response(JSON.stringify({ status: 'generated', title: '旧标题', diary: '旧摘要', portrait: { facts: [], feelings: [], observations: [], uncertainties: [] }, model: { provider: 'qwen', id: 'fake' }, generatedAt: '2026-09-30T10:00:00Z' })))
  await waitFor(() => expect(screen.getByRole('button', { name: '整理今天' })).toBeEnabled())
  expect(save).not.toHaveBeenCalled()
})

it('keeps an editing draft when sources change and blocks a stale save', () => {
  const save = vi.fn()
  const record = createDailyRecord('2026-09-30', [message])
  const view = render(<DailyAlbum record={record} onSave={save} modelReady />)
  fireEvent.click(screen.getByRole('button', { name: '编辑日记' }))
  fireEvent.change(screen.getByLabelText('日记正文'), { target: { value: '还未保存的日记' } })
  view.rerender(<DailyAlbum record={createDailyRecord('2026-09-30', [{ ...message, text: '已更新' }])} onSave={save} modelReady />)
  expect(screen.getByLabelText('日记正文')).toHaveValue('还未保存的日记')
  fireEvent.click(screen.getByRole('button', { name: '保存日记' }))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '下载编辑草稿' })).toBeVisible()
})

it('rejects a malformed portrait without writing it to the archive', async () => {
  const save = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'generated', title: '标题', diary: '正文', portrait: { facts: [], feelings: null, observations: [], uncertainties: [] }, model: { provider: 'qwen', id: 'fake' }, generatedAt: '2026-09-30T10:00:00Z' }))))
  render(<DailyAlbum record={createDailyRecord('2026-09-30', [message])} onSave={save} modelReady />)
  fireEvent.click(screen.getByRole('button', { name: '整理今天' }))
  await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
  expect(save).not.toHaveBeenCalled()
})

it('shows archived times in the space timezone instead of presenting UTC as local time', () => {
  render(<DailyAlbum record={createDailyRecord('2026-09-30', [message])} onSave={vi.fn()} modelReady={false} timezone="Asia/Shanghai" />)
  fireEvent.click(screen.getByRole('button', { name: '记录背面' }))
  expect(screen.getByText('2026/09/30 17:00')).toBeVisible()
})
