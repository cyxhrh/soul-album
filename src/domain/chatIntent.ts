/** Demo-only language rules. Anything ambiguous remains an ordinary message. */
export type ChatIntent = 'ordinary' | 'share' | 'skip' | 'decline' | 'more'

const shortPhrases: Record<string, Exclude<ChatIntent, 'ordinary' | 'share'>> = {
  '换个问题': 'skip',
  '换一个问题': 'skip',
  '换个话题': 'skip',
  '我想换个话题': 'skip',
  '跳过这一题': 'skip',
  '跳过这题': 'skip',
  '跳过': 'skip',
  '今天不想回答': 'decline',
  '今天不想答': 'decline',
  '今天先不聊了': 'decline',
  '今天先到这里': 'decline',
  '不想回答': 'decline',
  '再问我一个问题': 'more',
  '再问我一题': 'more',
}

export function classifyChatIntent(message: string): ChatIntent {
  const exact = message.trim().replace(/[。！？!?，,、\s]+$/u, '').trim()
  if (exact in shortPhrases) return shortPhrases[exact]
  if (/^(随手记|主动记录|记录一下)[：:]\s*\S/u.test(message.trim())) return 'share'
  return 'ordinary'
}
