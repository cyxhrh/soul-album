export type DailySource = 'steps' | 'heartRate' | 'spending'
export type DailyVisibility = Record<DailySource, boolean>
export type DailyExpense = { category: string; amount: number }
export type JudgeDailySample = {
  date: string
  label: string
  short: string
  steps: number
  heartRate: number
  expenses: readonly DailyExpense[]
  through: string
  partial?: boolean
}

/** Invented examples only: no device, health account or payment account is read. */
export const DAILY_SAMPLES: readonly JudgeDailySample[] = [
  { date: '2026-09-28', label: '9 月 28 日', short: '9.28', steps: 6430, heartRate: 64, expenses: [{ category: '餐饮', amount: 25 }, { category: '交通', amount: 12 }], through: '23:59' },
  { date: '2026-09-29', label: '9 月 29 日', short: '9.29', steps: 5120, heartRate: 64, expenses: [{ category: '餐饮', amount: 29 }, { category: '日用品', amount: 16 }], through: '23:59' },
  { date: '2026-09-30', label: '9 月 30 日', short: '9.30', steps: 7310, heartRate: 62, expenses: [{ category: '餐饮', amount: 24 }, { category: '交通', amount: 10 }], through: '23:59' },
  { date: '2026-10-01', label: '10 月 1 日', short: '10.01', steps: 8150, heartRate: 65, expenses: [{ category: '餐饮', amount: 78 }, { category: '交通', amount: 20 }], through: '23:59' },
  { date: '2026-10-02', label: '10 月 2 日', short: '10.02', steps: 4380, heartRate: 64, expenses: [{ category: '餐饮', amount: 26 }, { category: '交通', amount: 6 }], through: '23:59' },
  { date: '2026-10-03', label: '10 月 3 日', short: '10.03', steps: 8926, heartRate: 63, expenses: [{ category: '餐饮', amount: 68 }, { category: '交通', amount: 18 }], through: '23:59' },
  { date: '2026-10-04', label: '10 月 4 日', short: '10.04', steps: 2360, heartRate: 65, expenses: [{ category: '餐饮', amount: 24 }], through: '15:00', partial: true },
]

export const DAILY_SOURCE_INFO: Record<DailySource, { title: string; detail: string; unit: string; source: string; note: string }> = {
  steps: { title: '步数', detail: '步数', unit: '步', source: '模拟手表', note: '走过的路，留个小小的记录。' },
  heartRate: { title: '静息心率', detail: '心率', unit: '次 / 分', source: '模拟手表', note: '记录身体的一项数据，不代表健康结论。' },
  spending: { title: '日常消费', detail: '消费', unit: '元', source: '模拟账本', note: '一顿饭、一段路，都是生活的小开销。' },
}

export const DAILY_SOURCE_KEYS: readonly DailySource[] = ['steps', 'heartRate', 'spending']

export function dailyValue(sample: JudgeDailySample, source: DailySource): number {
  return source === 'spending'
    ? sample.expenses.reduce((total, expense) => total + expense.amount, 0)
    : sample[source]
}

export function displayDailyValue(value: number, source: DailySource): string {
  return new Intl.NumberFormat('zh-CN', source === 'spending'
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 }).format(value)
}
