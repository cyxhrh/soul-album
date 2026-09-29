export type LocalQuestionKind = 'open' | 'moment' | 'entry' | 'observation' | 'multiple'

const questions: Record<LocalQuestionKind, readonly [string, ...string[]]> = {
  open: [
    '今天有什么想记下的？',
    '今天愿意从哪件小事聊起？',
    '如果想说，今天有什么片段想留在画册里？',
  ],
  moment: [
    '今天有没有一个小瞬间想留在画册里？',
    '还有哪个小片段想记一笔？',
    '如果愿意，今天有什么细节想留下？',
  ],
  entry: [
    '关于这段记录，还有什么想补充的吗？',
    '这段记录里，还有哪个细节想多说一点？',
    '围绕这段记录，你想继续聊聊，还是聊些别的？',
  ],
  observation: [
    '关于你补充的内容，还有什么想说的吗？',
    '你补充的那一部分，还想再说明一点吗？',
    '如果愿意，还想围绕那次补充聊些什么？',
  ],
  multiple: [
    '回看这些记录，今天还有什么想补充的吗？',
    '这些记录放在一起，你想先接着聊哪一件？',
    '关于这些记录，今天有哪个细节想继续说说？',
  ],
}

/** Rule-mode copy avoids verbatim private text and the two most recently shown questions. */
export function localQuestionText(kind: LocalQuestionKind, shownTexts: readonly string[]): string {
  const recent = shownTexts.slice(-2)
  const options = questions[kind]
  return options.find((candidate) => !recent.includes(candidate)) ?? options[0]
}
