import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { createJournalState, journalReducer } from '../../domain/journal'
import { selectAlbum } from '../../domain/selectors'
import AlbumPage from './AlbumPage'

afterEach(cleanup)

it('uses a neutral label for a record without explicit presentation metadata', () => {
  const journal = journalReducer(createJournalState('ahe'), {
    type: 'answer', entry: {
      id: 'ahe-watch-steps', day: 1, topicId: 'steps', text: '今天走了 4200 步。',
      occurredAt: '2026-09-01T18:00:00+08:00',
      recordedAt: '2026-09-01T20:00:00+08:00', source: '模拟手表',
    },
  })

  render(<AlbumPage mode="synthetic" album={selectAlbum(journal, 1)!} journal={journal}
    dateForDay={() => '2026年9月1日'} />)

  expect(screen.getByText('记录片段')).toBeVisible()
  expect(screen.queryByText('用户感受')).not.toBeInTheDocument()
})

it('shows a readable synthetic-photo fallback when its image cannot load', () => {
  let journal = journalReducer(createJournalState('ahe'), {
    type: 'answer', entry: {
      id: 'answer', day: 1, topicId: 'daily', text: '今天出门了',
      occurredAt: '2026-09-01T18:00:00+08:00', recordedAt: '2026-09-01T20:00:00+08:00', source: '合成回答',
    },
  })
  journal = journalReducer(journal, { type: 'addSourceFact', fact: {
    id: 'photo', sourceId: 'photo', day: 1, kind: 'photo', title: '雨后街角', detail: '合成示例照片',
    imageSrc: '/missing-photo.webp', source: '合成照片', device: '演示相册',
    occurredAt: '2026-09-01T18:00:00+08:00', recordedAt: '2026-09-01T20:00:00+08:00', simulated: true,
  } })
  journal = journalReducer(journal, { type: 'setSourceConsent', sourceId: 'photo', granted: true, updatedAt: '2026-09-01T20:01:00+08:00' })
  render(<AlbumPage mode="synthetic" album={selectAlbum(journal, 1)!} journal={journal} dateForDay={() => '2026年9月1日'} />)
  fireEvent.error(screen.getByRole('img', { name: '合成照片：雨后街角' }))
  expect(screen.getByText('合成照片暂时无法显示，资料说明仍可查看')).toBeVisible()
  expect(screen.queryByRole('img', { name: '合成照片：雨后街角' })).not.toBeInTheDocument()
  expect(screen.getByText('合成示例照片')).toBeVisible()
})

it('keeps private-mode pages free of synthetic-person labels even with an observation', () => {
  let journal = journalReducer(createJournalState('free'), {
    type: 'answer', entry: {
      id: 'private-answer', day: 1, topicId: 'daily-note', text: '我在窗边读书。',
      occurredAt: '2026-09-28T20:00:00+08:00', recordedAt: '2026-09-28T20:00:00+08:00', source: '本次页面回答',
    },
  })
  journal = journalReducer(journal, { type: 'addObservation', observation: {
    id: 'private-observation', day: 1, text: '我想先把这件事记下来。',
    entryIds: ['private-answer'], status: 'tentative',
  } })
  journal = journalReducer(journal, { type: 'correctObservation', id: 'private-observation', text: '只是记录，没有进一步结论。' })
  const { container } = render(<AlbumPage mode="private" album={selectAlbum(journal, 1)!} journal={journal}
    dateForDay={() => '第 1 天'} displayDateForDay={() => '2026年9月28日'} />)

  expect(container).toHaveTextContent('你的原话修正')
  expect(container).not.toHaveTextContent('阿禾')
  expect(container).not.toHaveTextContent('合成')
  expect(screen.getByText('2026年9月28日')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '详情 ↓' }))
  const details = screen.getByRole('region', { name: '页面详情' })
  expect(details).toHaveTextContent('单次授权发送的片段可能由百炼保存')
  expect(details).toHaveTextContent('演示日期时间')
})

it('renders all current corrections as printable content in their original order', () => {
  let journal = journalReducer(createJournalState('free'), {
    type: 'answer', entry: {
      id: 'source', day: 1, topicId: 'daily', text: '今天散步也读了书。',
      occurredAt: '2026-09-28T20:00:00+08:00', recordedAt: '2026-09-28T20:00:00+08:00', source: '本次页面回答',
    },
  })
  for (const [id, text] of [['o1', '第一条准确背景'], ['o2', '第二条准确背景']]) {
    journal = journalReducer(journal, { type: 'addObservation', observation: {
      id, day: 1, text: '待确认', entryIds: ['source'], status: 'tentative',
    } })
    journal = journalReducer(journal, { type: 'correctObservation', id, text })
  }
  const { container } = render(<AlbumPage mode="private" album={selectAlbum(journal, 1)!} journal={journal}
    dateForDay={() => '第 1 天'} />)

  expect(screen.getAllByRole('group', { name: '你的原话修正' })).toHaveLength(2)
  expect(container.textContent!.indexOf('第一条准确背景')).toBeLessThan(container.textContent!.indexOf('第二条准确背景'))
  expect(container.querySelectorAll('.story-observation')).toHaveLength(2)

  journal = journalReducer(journal, { type: 'deleteEntry', id: 'source' })
  expect(selectAlbum(journal, 1)).toBeNull()
})
