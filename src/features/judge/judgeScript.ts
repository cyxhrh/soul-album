import type { DailyAlbumContent, DailyMessage } from '../../../shared/dailyAlbum'
import { createDailyRecord, serializeDailyRecord, type DailyRecord } from '../album/dailyRecord'

/** All judge-demo copy lives here. These are synthetic examples, never private user records. */
export const DEMO_DATE = '2026-10-04'
export const REPLY_DELAY = 1100
export const DEMO_OPENING = '下午好呀，我在。今天有没有一个小片刻，你想留下来？开心的事、没想明白的事，都可以慢慢说。'
export const DEMO_ROUNDS = [
  {
    user: '昨晚和朋友吃饭，聊了好多最近的事，很开心。',
    reply: '听起来，那顿饭给你留下了很好的回忆。是聊到了什么，还是单纯坐在一起就很开心？',
    hint: '留下一个生活片刻',
  },
  {
    user: '坐在一起就很开心。不过返程过了零点，今天起床有点累。',
    reply: '你在 10 月 1 日也说过，晚归后第二天很累。两次都发生在聚会之后，我可能会猜：聚会本身有些耗力。这个理解贴近你的感受吗？',
    hint: '连接之前的记录',
  },
  {
    user: '不是聚会让我累，和朋友相处让我开心，可能是返程太晚。',
    reply: '谢谢你说清楚。我撤回“聚会本身耗力”的猜测，改成：和朋友相处让你开心；疲惫可能与晚归有关，但原因还不能确定。画册里的理解也一起改好了。',
    hint: '纠正知知的理解',
  },
  {
    user: '对，帮我把这份开心和补充的解释一起记下来吧。',
    reply: '记下来了：见朋友很开心，晚归后有些疲惫。你的原话和这次纠正都留在画册背面，方便回看。下次想说的时候，我们再聊聊早一点回家的一天是什么感觉。',
    hint: '翻开正反两面的画册',
  },
] as const

function message(id: string, role: DailyMessage['role'], text: string, date: string, minute: number): DailyMessage {
  return { id, role, text, recordedAt: `${date}T08:${String(minute).padStart(2, '0')}:00Z` }
}

function record(date: string, messages: DailyMessage[], content: DailyAlbumContent, revision = 0): DailyRecord {
  return { ...createDailyRecord(date, messages), ...content, revision }
}

export const PAST_RECORDS: DailyRecord[] = [
  record('2026-09-28', [
    message('judge-past-1-user', 'user', '晚饭后和朋友散步，聊到天黑就各自回家了。今天心情很好。', '2026-09-28', 0),
    message('judge-past-1-ai', 'assistant', '一段不用赶路的散步，也可以是今天值得留下的小事。', '2026-09-28', 1),
  ], { title: '走到天黑，刚刚好', diary: '晚饭后，和朋友散了一会儿步。聊到天黑，各自回家。\n\n没有特别的安排，心情却很好。', portrait: {
    facts: ['晚饭后与朋友散步，天黑后回家。'], feelings: ['自述今天心情很好。'],
    observations: [{ text: '这次和朋友散步带来了愉快的体验。', evidenceIds: ['judge-past-1-user'] }],
    uncertainties: ['没有分享其他经历，不能据此判断长期社交偏好。'],
  } }),
  record('2026-10-01', [
    message('judge-past-2-user', 'user', '昨天聚会很开心，返程过了零点。今天起床很累。', '2026-10-01', 0),
    message('judge-past-2-ai', 'assistant', '开心和疲惫可以同时存在。先把这两件事都记下来，原因不用急着判断。', '2026-10-01', 1),
  ], { title: '开心的晚聚，困倦的早晨', diary: '昨天的聚会很开心，返程已经过了零点。\n\n今天起床很累。先留下这份开心，也记得让自己休息一会儿。', portrait: {
    facts: ['聚会后返程过零点，次日起床疲惫。'], feelings: ['自述聚会开心。'],
    observations: [{ text: '这一次，晚归与次日疲惫先后出现。', evidenceIds: ['judge-past-2-user'] }],
    uncertainties: ['先后出现不等于因果，尚不清楚疲惫的原因。'],
  } }),
  record('2026-10-02', [
    message('judge-past-3-user', 'user', '下午把小项目讲给朋友听，一开始有点紧张，讲着讲着思路清楚了。接下来先把首页做好。', '2026-10-02', 0),
    message('judge-past-3-ai', 'assistant', '把想法说出来，也帮你理清了下一步。今天就留下这个小小的进展吧。', '2026-10-02', 1),
  ], { title: '说出来，思路就清楚了', diary: '下午，把正在做的小项目讲给朋友听。开始有点紧张，讲着讲着，自己的思路也清楚了。\n\n下一步，先把首页做好。', portrait: {
    facts: ['向朋友介绍了小项目，计划先完善首页。'], feelings: ['起初紧张，随后思路清晰。'],
    observations: [{ text: '这次讲述帮助了思路整理，是否适用于其他情境还不确定。', evidenceIds: ['judge-past-3-user'] }],
    uncertainties: ['一次经历不足以判断长期习惯。'],
  } }),
]

export function todayRecord(completed: number, pending = false): DailyRecord {
  const messages = [message('judge-opening', 'assistant', DEMO_OPENING, DEMO_DATE, 0)]
  DEMO_ROUNDS.forEach((round, index) => {
    if (index < completed || (index === completed && pending)) {
      messages.push(message(`judge-user-${index + 1}`, 'user', round.user, DEMO_DATE, index * 2 + 1))
    }
    if (index < completed) messages.push(message(`judge-ai-${index + 1}`, 'assistant', round.reply, DEMO_DATE, index * 2 + 2))
  })
  const corrected = completed >= 3
  return record(DEMO_DATE, messages, {
    title: completed === 0 ? '今天，等你留下一句话' : completed === 1 ? '坐在一起，就很开心' : '开心留给聚会，休息留给自己',
    diary: completed === 0 ? '' : completed === 1 ? '昨晚和朋友吃饭，聊了很多最近的事。那份开心，想好好留下来。'
      : '昨晚和朋友吃饭，坐在一起聊天就很开心。返程过了零点，今天起床有些累。\n\n' +
        (corrected ? '和朋友相处带来的是开心。疲惫可能与返程太晚有关，这个解释还需要以后的经历来核对。' : '开心和疲惫都被记下了，原因还在慢慢确认。'),
    portrait: {
      facts: completed === 0 ? [] : ['昨晚与朋友吃饭聊天。', ...(completed >= 2 ? ['返程过零点，今天起床疲惫。'] : [])],
      feelings: completed === 0 ? [] : ['与朋友相处时感到开心。'],
      observations: completed < 2 ? [] : [{
        text: corrected ? '根据用户补充，撤回“聚会本身耗力”的猜测；疲惫可能与晚归有关，暂不确认因果。'
          : '暂定猜测：聚会本身可能耗力。需要用户确认，不能作为确定结论。',
        evidenceIds: corrected ? ['judge-user-2', 'judge-user-3'] : ['judge-user-2'],
      }],
      uncertainties: completed === 0 ? [] : ['记录只覆盖主动分享的片段，不能代表完整的一天。', ...(completed >= 2 ? ['疲惫的具体原因尚未确认。'] : [])],
    },
  }, corrected ? 1 : 0)
}

export function demoMarkdown(record: DailyRecord): string {
  return '> 预设示例：以下对话、日记与肖像均为合成内容，用于比赛演示；不代表实时模型生成或真实用户数据。\n\n' + serializeDailyRecord(record)
}
