export type BehaviorSource = 'steps' | 'spending' | 'screenTime'

export type BehaviorSample = {
  id: BehaviorSource
  label: string
  source: string
  unit: string
  description: string
  values: readonly number[]
}

// Fixed, invented numbers for the product prototype. No device, account or app data is read.
export const sampleDays = [
  { date: '9月22日', short: '22' },
  { date: '9月23日', short: '23' },
  { date: '9月24日', short: '24' },
  { date: '9月25日', short: '25' },
  { date: '9月26日', short: '26' },
  { date: '9月27日', short: '27' },
  { date: '9月28日', short: '28' },
] as const

export const behaviorSamples: readonly BehaviorSample[] = [
  {
    id: 'steps',
    label: '手表步数',
    source: '模拟手表',
    unit: '步',
    description: '演示手表每天记录的步数。',
    values: [4320, 6870, 5210, 8040, 7440, 11300, 6900],
  },
  {
    id: 'spending',
    label: '手机消费记录',
    source: '模拟手机消费记录',
    unit: '元',
    description: '演示每天的消费总额，不包含商家或商品明细。',
    values: [32.5, 78.2, 0, 116.9, 24.8, 52, 39.9],
  },
  {
    id: 'screenTime',
    label: '应用时长',
    source: '模拟系统使用统计',
    unit: '分钟',
    description: '演示每天使用手机应用的总时长。',
    values: [206, 179, 231, 188, 155, 212, 165],
  },
] as const
