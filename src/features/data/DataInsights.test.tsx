import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import DataInsights, { type BehaviorConsents, type BehaviorSource } from './DataInsights'

afterEach(cleanup)

const noConsent: BehaviorConsents = { steps: false, spending: false, screenTime: false }

function ControlledInsights() {
  const [consents, setConsents] = useState<BehaviorConsents>(noConsent)
  const onToggle = (source: BehaviorSource) => {
    setConsents((current) => ({ ...current, [source]: !current[source] }))
  }
  return <DataInsights consents={consents} onToggle={onToggle} />
}

it('shows three independent, initially closed simulation controls without charts', () => {
  render(<DataInsights consents={noConsent} onToggle={vi.fn()} />)

  expect(screen.getByRole('heading', { name: '生活数据' })).toBeVisible()
  expect(screen.getByText(/模拟授权.*未连接真实设备/)).toBeVisible()
  expect(screen.getByRole('region', { name: '手表步数' })).toBeVisible()
  expect(screen.getByRole('region', { name: '手机消费记录' })).toBeVisible()
  expect(screen.getByRole('region', { name: '应用时长' })).toBeVisible()
  expect(screen.queryByRole('img', { name: /七日图表/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /^开启.*模拟授权$/ })).toHaveLength(3)
})

it('only reveals the enabled source, with its provenance, range, unit and seven readable values', () => {
  render(<ControlledInsights />)

  fireEvent.click(screen.getByRole('button', { name: '开启手表步数模拟授权' }))
  const steps = screen.getByRole('region', { name: '手表步数' })
  expect(within(steps).getByRole('img', { name: /手表步数七日图表/ })).toBeVisible()
  expect(within(steps).getByText('模拟手表')).toBeVisible()
  expect(within(steps).getByText(/2026年9月22日.*9月28日/)).toBeVisible()
  const table = within(steps).getByRole('table', { name: '手表步数每日数值' })
  expect(within(table).getAllByRole('row')).toHaveLength(8)
  expect(within(table).getByText('4,320 步')).toBeVisible()
  expect(within(screen.getByRole('region', { name: '手机消费记录' })).queryByRole('table')).not.toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: '应用时长' })).queryByRole('img')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '开启应用时长模拟授权' }))
  const usage = screen.getByRole('region', { name: '应用时长' })
  expect(within(usage).getByRole('table', { name: '应用时长每日数值' })).toBeVisible()
  expect(within(usage).getByText('模拟系统使用统计')).toBeVisible()
  expect(screen.getAllByRole('img', { name: /七日图表/ })).toHaveLength(2)
})

it('withdraws one source immediately without affecting another', () => {
  render(<ControlledInsights />)
  fireEvent.click(screen.getByRole('button', { name: '开启手表步数模拟授权' }))
  fireEvent.click(screen.getByRole('button', { name: '开启手机消费记录模拟授权' }))

  fireEvent.click(screen.getByRole('button', { name: '撤回手表步数模拟授权' }))
  expect(within(screen.getByRole('region', { name: '手表步数' })).queryByRole('img')).not.toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: '手表步数' })).queryByRole('table')).not.toBeInTheDocument()
  const spending = screen.getByRole('region', { name: '手机消费记录' })
  expect(within(spending).getByRole('img', { name: /七日图表/ })).toBeVisible()
  expect(within(spending).getByRole('table', { name: '手机消费记录每日数值' })).toBeVisible()
})

it('keeps consent under parent control and avoids behavioral judgments', () => {
  const onToggle = vi.fn()
  const { rerender } = render(<DataInsights consents={noConsent} onToggle={onToggle} />)
  fireEvent.click(screen.getByRole('button', { name: '开启手机消费记录模拟授权' }))
  expect(onToggle).toHaveBeenCalledWith('spending')
  expect(screen.queryByRole('table')).not.toBeInTheDocument()

  rerender(<DataInsights consents={{ ...noConsent, spending: true }} onToggle={onToggle} />)
  expect(screen.getByRole('table', { name: '手机消费记录每日数值' })).toBeVisible()
  expect(screen.getByRole('region', { name: '手机消费记录' })).not.toHaveTextContent(/焦虑|抑郁|人格|冲动消费|不健康/)
})
