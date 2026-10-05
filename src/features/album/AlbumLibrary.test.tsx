import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import AlbumLibrary, { ALBUM_PAGE_SIZE, albumExcerpt, matchesAlbum } from './AlbumLibrary'
import { HISTORY_RECORDS } from '../judge/judgeHistory'
import { PAST_RECORDS, todayRecord } from '../judge/judgeScript'

const records = [...HISTORY_RECORDS, ...PAST_RECORDS, todayRecord(4)]
beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function Harness() {
  const [date, setDate] = useState<string | null>(null)
  return <AlbumLibrary records={records} todayDate="2026-10-04" selectedDate={date} onSelect={setDate} active renderRecord={record => <article aria-label="阅读内容">{record.date} {record.title}</article>} />
}

it('has hundreds of unique, sparse, past synthetic pages without replacing scripted records', () => {
  expect(records.length).toBeGreaterThan(300)
  expect(new Set(records.map(record => record.date)).size).toBe(records.length)
  expect(HISTORY_RECORDS.every(record => record.date < '2026-09-28' && record.model === undefined)).toBe(true)
  const dates = HISTORY_RECORDS.map(record => record.date)
  expect(dates).not.toContain('2025-01-01')
  expect(dates.some(date => date.startsWith('2025-'))).toBe(true)
  expect(dates.some(date => date.startsWith('2026-'))).toBe(true)
})

it('opens the latest month and expands a large global search in bounded batches', () => {
  render(<Harness />)
  expect(screen.getByRole('heading', { name: '十月' })).toBeVisible()
  expect(screen.getAllByRole('button', { name: /^阅读 / })).toHaveLength(3)
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索全部记录' }), { target: { value: '朋友' } })
  expect(screen.getAllByRole('button', { name: /^阅读 / })).toHaveLength(ALBUM_PAGE_SIZE)
  expect(screen.getByText('搜索范围：全部月份')).toBeVisible()
  expect(document.querySelector('mark')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: `再翻 ${ALBUM_PAGE_SIZE} 页` }))
  expect(screen.getAllByRole('button', { name: /^阅读 / })).toHaveLength(ALBUM_PAGE_SIZE * 2)
  fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
  expect(screen.getAllByRole('button', { name: /^阅读 / })).toHaveLength(3)
})

it('preserves query and expanded results after reading and skips gaps between adjacent records', () => {
  render(<Harness />)
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索全部记录' }), { target: { value: '台灯' } })
  fireEvent.click(screen.getByRole('button', { name: `再翻 ${ALBUM_PAGE_SIZE} 页` }))
  const first = screen.getAllByRole('button', { name: /^阅读 / })[0]
  fireEvent.click(first)
  expect(screen.getByRole('article', { name: '阅读内容' })).toHaveTextContent('修好台灯')
  fireEvent.click(screen.getByRole('button', { name: '← 返回搜索结果' }))
  expect(screen.getByRole('searchbox')).toHaveValue('台灯')
  expect(screen.getAllByRole('button', { name: /^阅读 / })).toHaveLength(ALBUM_PAGE_SIZE * 2)
  expect(screen.getAllByRole('button', { name: /^阅读 / })[0]).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
  fireEvent.click(screen.getByRole('button', { name: '回到今天 ↗' }))
  fireEvent.click(screen.getByRole('button', { name: '← 上一条记录' }))
  expect(screen.getByRole('article', { name: '阅读内容' })).toHaveTextContent('2026-10-02')
  fireEvent.click(screen.getByRole('button', { name: '下一条记录 →' }))
  expect(screen.getByRole('article', { name: '阅读内容' })).toHaveTextContent('2026-10-04')
  expect(screen.getByRole('button', { name: '下一条记录 →' })).toBeDisabled()
})

it('lets an older year open a month and provides a useful empty search state', () => {
  render(<Harness />)
  const sidebar = screen.getByLabelText('画册月份目录')
  fireEvent.click(within(sidebar).getByText('2025', { exact: true }))
  fireEvent.click(within(sidebar).getByRole('button', { name: '2025年3月' }))
  expect(screen.getByRole('heading', { name: '三月' })).toBeVisible()
  expect(screen.getAllByRole('button', { name: /^阅读 / })[0]).toHaveAccessibleName(/2025年3月/)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在的片段xyz' } })
  expect(screen.queryAllByRole('button', { name: /^阅读 / })).toHaveLength(0)
  expect(screen.getByText('还没找到这个片刻')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '返回月份目录' }))
  expect(screen.getByRole('heading', { name: '三月' })).toBeVisible()
})

it('finds user wording absent from the diary and keeps a matching excerpt visible', () => {
  const baseline = todayRecord(4)
  const record = { ...baseline, title: '一个片刻', diary: '精简的记录', messages: [{ ...baseline.messages[1], text: `${'很长的铺垫。'.repeat(50)}返程太晚${'后续。'.repeat(50)}` }] }
  expect(matchesAlbum(record, '  返程太晚  ')).toBe(true)
  expect(albumExcerpt(record, '返程太晚')).toContain('返程太晚')
  expect(albumExcerpt(record, '返程太晚').length).toBeLessThan(120)
  expect(matchesAlbum(record, '不存在')).toBe(false)
})
