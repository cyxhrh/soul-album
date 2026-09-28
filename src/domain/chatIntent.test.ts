import { describe, expect, it } from 'vitest'
import { classifyChatIntent } from './chatIntent'

describe('the intentionally narrow local conversation rules', () => {
  it.each([
    ['换个问题', 'skip'], ['跳过这一题。', 'skip'], ['换个话题！', 'skip'], ['我想换个话题', 'skip'], ['跳过， ', 'skip'],
    ['今天不想回答', 'decline'], ['今天不想答。', 'decline'], [' 今天先不聊了  ', 'decline'], ['不想回答', 'decline'],
    ['再问我一个问题', 'more'], ['再问我一题？', 'more'],
  ] as const)('recognizes only the whole short phrase %s', (message, intent) => {
    expect(classifyChatIntent(message)).toBe(intent)
  })

  it.each([
    '今天不想答但我想记一件事。', '换个问题，我先讲讲刚才发生的事。',
    '我今天说了“今天先不聊了”，但后来和朋友通话。', '再问我一个问题之前先记一笔。',
    '我想换个话题聊工作。',
  ])('keeps mixed-content messages as ordinary records: %s', (message) => {
    expect(classifyChatIntent(message)).toBe('ordinary')
  })

  it('recognizes a voluntary note only with a clear nonempty prefix', () => {
    expect(classifyChatIntent('随手记：下班时看到了晚霞。')).toBe('share')
    expect(classifyChatIntent('记录一下：')).toBe('ordinary')
    expect(classifyChatIntent('今天我想记录一下下班的晚霞。')).toBe('ordinary')
  })
})
