/** Fixed, invented source material for the restricted model experiment. */
export const AHE_SCENARIO_VERSION = 'ahe-v1'

export const AHE_SYNTHETIC_SNIPPETS = [
  { id: 'ahe-past-friends', quote: '和朋友吃饭很开心，回家后休息得早。' },
  { id: 'ahe-past-return', quote: '活动结束后返程过零点，第二天起床很累。' },
  { id: 'ahe-today-joy', quote: '昨晚见了朋友，聊天很开心。' },
  { id: 'ahe-today-return', quote: '返程过零点，今天起床才觉得累。' },
] as const

export const AHE_CONFIRMED_CONTEXT = '阿禾补充：和朋友相处让我开心，可能是返程太晚。原因尚未确定。'
