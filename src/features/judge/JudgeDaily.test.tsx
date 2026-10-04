import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import JudgeDaily from './JudgeDaily'

afterEach(cleanup)

const props = {
  completed: 0,
  companionName: '知知',
  companionSrc: '/brand/zhizhi.png',
  onChat: vi.fn(),
  onAlbum: vi.fn(),
}

function sources() {
  fireEvent.click(screen.getByText('数据来源'))
}

it('switches all metrics and consumption details together while keeping the partial day explicit', () => {
  render(<JudgeDaily {...props} />)
  expect(screen.getByRole('heading', { name: '10 月 4 日，生活的一页' })).toBeVisible()
  expect(screen.getByText(/截至 15:00/)).toBeVisible()
  expect(within(screen.getByRole('region', { name: '步数' })).getByText('2,360')).toBeVisible()
  expect(within(screen.getByRole('region', { name: '静息心率' })).getByText('65')).toBeVisible()
  expect(within(screen.getByRole('region', { name: '日常消费' })).getByText('24.00')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '查看消费明细' }))
  const spending = screen.getByRole('region', { name: '消费七日明细' })
  expect(within(spending).getByRole('table', { name: '2026年10月4日消费组成' })).toHaveTextContent('餐饮24.00 元')
  fireEvent.click(screen.getByRole('button', { name: '查看2026年10月3日的日常' }))
  expect(screen.getByRole('heading', { name: '10 月 3 日，生活的一页' }).parentElement).not.toHaveTextContent('截至 15:00')
  expect(within(screen.getByRole('region', { name: '步数' })).getByText('8,926')).toBeVisible()
  expect(within(screen.getByRole('region', { name: '静息心率' })).getByText('63')).toBeVisible()
  expect(within(screen.getByRole('region', { name: '日常消费' })).getByText('86.00')).toBeVisible()
  expect(within(spending).getByRole('table', { name: '2026年10月3日消费组成' })).toHaveTextContent('餐饮68.00 元交通18.00 元')
})

it('withdraws an open source without leaving values or its chart behind', () => {
  render(<JudgeDaily {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '查看步数明细' }))
  expect(screen.getByRole('region', { name: '步数七日明细' })).toBeVisible()
  expect(screen.getByRole('table', { name: '步数每日数值' })).toBeVisible()
  sources()
  fireEvent.click(screen.getByRole('checkbox', { name: '显示步数示例' }))
  expect(screen.queryByRole('region', { name: '步数七日明细' })).not.toBeInTheDocument()
  expect(screen.queryByRole('img', { name: /步数七日图表/ })).not.toBeInTheDocument()
  expect(screen.queryByText('2,360')).not.toBeInTheDocument()
  expect(screen.queryByText(/昨天走了不少路/)).not.toBeInTheDocument()
  const steps = screen.getByRole('region', { name: '步数' })
  expect(steps).toHaveTextContent('未显示')
  expect(within(steps).queryByRole('button', { name: '查看步数明细' })).not.toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: '静息心率' })).getByText('65')).toBeVisible()
  expect(screen.getByRole('checkbox', { name: '显示心率示例' })).toBeChecked()
})

it('replaces all hidden data with an empty state instead of zero or a numerical care claim', () => {
  render(<JudgeDaily {...props} completed={4} />)
  sources()
  for (const name of ['显示步数示例', '显示心率示例', '显示消费示例']) {
    fireEvent.click(screen.getByRole('checkbox', { name }))
  }
  const care = screen.getByRole('region', { name: '知知的一点关心' })
  expect(care).toHaveTextContent('开启一个示例')
  expect(care).not.toHaveTextContent(/昨晚|返程|心里挺亮|\d/)
  expect(screen.getAllByText('未显示')).toHaveLength(3)
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '显示心率示例' }))
  expect(within(screen.getByRole('region', { name: '静息心率' })).getByText('65')).toBeVisible()
  expect(care).not.toHaveTextContent('开启一个示例')
  expect(care).not.toHaveTextContent(/昨天走了不少路|健康|正常|焦虑/)
})

it('only connects the user story after its correction and confirmation have arrived', () => {
  const { rerender } = render(<JudgeDaily {...props} completed={2} />)
  const care = screen.getByRole('region', { name: '知知的一点关心' })
  expect(care).not.toHaveTextContent(/你说昨晚|等车又换车|朋友认真听/)
  rerender(<JudgeDaily {...props} completed={3} />)
  expect(care).toHaveTextContent('你说昨晚跟朋友待着很放松')
  expect(care).toHaveTextContent('等车又换车')
  expect(care).not.toHaveTextContent('朋友认真听')
  rerender(<JudgeDaily {...props} completed={4} />)
  expect(care).toHaveTextContent('朋友认真听')
  fireEvent.click(screen.getByRole('button', { name: '查看2026年10月3日的日常' }))
  expect(care).not.toHaveTextContent(/你说昨晚|等车又换车|朋友认真听/)
})

it('shows one source detail at a time with seven exact values and no medical interpretation', () => {
  render(<JudgeDaily {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '查看步数明细' }))
  fireEvent.click(screen.getByRole('button', { name: '查看心率明细' }))
  expect(screen.queryByRole('region', { name: '步数七日明细' })).not.toBeInTheDocument()
  const heart = screen.getByRole('region', { name: '心率七日明细' })
  const table = within(heart).getByRole('table', { name: '心率每日数值' })
  expect(within(table).getAllByRole('row')).toHaveLength(8)
  expect(heart).toHaveTextContent('模拟手表')
  expect(heart).not.toHaveTextContent(/正常|健康评分|诊断|焦虑|偏高|偏低/)
})

it('retains a selected day and hidden source when new conversation progress arrives', () => {
  const { rerender } = render(<JudgeDaily {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '查看2026年10月3日的日常' }))
  sources()
  fireEvent.click(screen.getByRole('checkbox', { name: '显示消费示例' }))
  rerender(<JudgeDaily {...props} completed={4} companionName="小笺" companionSrc="/xiaojian.png" />)
  expect(screen.getByRole('button', { name: '查看2026年10月3日的日常' })).toHaveAttribute('aria-current', 'date')
  expect(screen.getByRole('checkbox', { name: '显示消费示例' })).not.toBeChecked()
  expect(screen.getByRole('region', { name: '日常消费' })).toHaveTextContent('未显示')
  expect(screen.getByRole('region', { name: '小笺的一点关心' })).toBeVisible()
})
