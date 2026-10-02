/** Versioned by ID if copy changes: the UI and model must see the same opening. */
export const chatOpenings = {
  morning: { greeting: '早上好呀 ☀️ 新的一天开始啦！', question: '今天有什么让你期待的安排？' },
  noon: { greeting: '中午好呀，到了吃点好东西的时间啦。', question: '今天午饭吃了什么，或者准备吃什么？' },
  afternoon: { greeting: '下午好呀，来聊两句吧～', question: '你刚刚在做什么？' },
  evening: { greeting: '晚上好呀 🌙 可以慢慢聊。', question: '今天有没有什么小事，想跟我分享？' },
  'late-night': { greeting: '这个时间，想说的话可以慢慢说。', question: '此刻有什么在你脑海里打转？' },
} as const

export type ChatOpeningId = keyof typeof chatOpenings

export function isChatOpeningId(value: unknown): value is ChatOpeningId {
  return typeof value === 'string' && Object.hasOwn(chatOpenings, value)
}

/** Use the browser's local hour once, when a new conversation is created. */
export function openingForHour(hour: number): ChatOpeningId {
  if (hour >= 6 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 14) return 'noon'
  if (hour >= 14 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 23) return 'evening'
  return 'late-night'
}
