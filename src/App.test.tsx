import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'

afterEach(cleanup)

describe('Soul Album product', () => {
  it('opens directly in the conversation and keeps its three product tabs', () => {
    render(<App />)

    expect(screen.getByRole('main', { name: '心灵画册产品' })).toBeVisible()
    expect(screen.getByRole('region', { name: '对话记录' })).toBeVisible()
    expect(screen.getByText('今天有什么想记下的？')).toBeVisible()
    const navigation = screen.getByRole('navigation', { name: '产品导航' })
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '对话', '画册', '生活数据',
    ])
    expect(screen.queryByText('每天问一点，慢慢看见自己')).not.toBeInTheDocument()
  })

  it('shares a record between chat and album without losing the message draft on tab switch', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: '发送消息' }), {
      target: { value: '傍晚散步时看见一朵云。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(screen.getByRole('region', { name: '对话记录' })).toHaveTextContent('傍晚散步时看见一朵云。')
    fireEvent.change(screen.getByRole('textbox', { name: '发送消息' }), {
      target: { value: '第二句还没写完' },
    })

    fireEvent.click(screen.getByRole('button', { name: '画册' }))
    expect(screen.getByRole('article', { name: '第 1 天画册页' })).toHaveTextContent('傍晚散步时看见一朵云。')
    fireEvent.click(screen.getByRole('button', { name: '对话' }))
    expect(screen.getByRole('textbox', { name: '发送消息' })).toHaveValue('第二句还没写完')
  })

  it('keeps the same session when browsing data and clearing it', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '生活数据' }))
    expect(screen.getByRole('region', { name: '生活数据' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '对话' }))
    expect(screen.getByRole('region', { name: '对话记录' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '清除本次内容' }))
    expect(screen.getByText('今天有什么想记下的？')).toBeVisible()
  })
})
