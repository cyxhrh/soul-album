export type BehaviorSource = 'steps' | 'spending' | 'screenTime'
export type CareBand = { maxInclusive: number; range: string; message: string }

export type BehaviorSample = {
  id: BehaviorSource
  label: string
  source: string
  unit: string
  description: string
  values: readonly number[]
  careBands: readonly [CareBand, ...CareBand[]]
}

/** Fixed demo copy, selected from invented values; it does not infer a user's state. */
export function careBandForValue(sample: BehaviorSample, value: number): CareBand {
  return sample.careBands.find((band) => value <= band.maxInclusive) ?? sample.careBands[sample.careBands.length - 1]
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
    careBands: [
      { maxInclusive: 4999, range: '少于 5,000 步', message: '这一天记录的步数不多。如果愿意，也可以记下一段路上的小事。' },
      { maxInclusive: 8999, range: '5,000–8,999 步', message: '这一天留下了一些脚步。你可以自己决定哪些片刻值得记录。' },
      { maxInclusive: Infinity, range: '9,000 步及以上', message: '这一天记录的脚步较多。愿意的话，给那段路写一句话。' },
    ],
  },
  {
    id: 'spending',
    label: '手机消费记录',
    source: '模拟手机消费记录',
    unit: '元',
    description: '演示每天的消费总额，不包含商家或商品明细。',
    values: [32.5, 78.2, 0, 116.9, 24.8, 52, 39.9],
    careBands: [
      { maxInclusive: 0, range: '0 元', message: '合成样例中这一天没有消费记录；数字本身不需要解释。' },
      { maxInclusive: 50, range: '0 元以上至 50 元', message: '这一天有一些日常开销。这里只展示金额，不评价选择。' },
      { maxInclusive: Infinity, range: '超过 50 元', message: '这一天的金额留在这里；它不能说明你是什么样的人。' },
    ],
  },
  {
    id: 'screenTime',
    label: '应用时长',
    source: '模拟系统使用统计',
    unit: '分钟',
    description: '演示每天使用手机应用的总时长。',
    values: [206, 179, 231, 188, 155, 212, 165],
    careBands: [
      { maxInclusive: 179, range: '少于 180 分钟', message: '这只是屏幕上的时间；屏幕之外的生活也值得记录。' },
      { maxInclusive: 210, range: '180–210 分钟', message: '一天不只由应用时长组成。想记下别的片刻也可以。' },
      { maxInclusive: Infinity, range: '超过 210 分钟', message: '这一天的应用时长较长，但不能据此判断你的状态。' },
    ],
  },
] as const
