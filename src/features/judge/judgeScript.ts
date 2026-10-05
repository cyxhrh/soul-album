import type { DailyAlbumContent, DailyMessage } from '../../../shared/dailyAlbum'
import { createDailyRecord, serializeDailyRecord, type DailyRecord } from '../album/dailyRecord'

/** All judge-demo copy lives here. These are synthetic examples, never private user records. */
export const DEMO_DATE = '2026-10-04'
export const REPLY_DELAY = 1100
export const REPLY_PART_DELAY = 900
export const DEMO_OPENING = '下午好呀！今天我们聊点开心的：最近有没有哪个小瞬间，让你现在想起来还会笑？和朋友吃顿饭、聊会儿天也算，我想听听。'
const SCRIPT_ROUNDS = [
  {
    user: '昨晚跟朋友吃了个饭，聊到好晚，好久没这么开心了。',
    replies: ['听你这么说，我也替你开心。昨晚有什么让你特别开心的小瞬间吗？'],
    hint: '留下一个生活片刻',
  },
  {
    user: '没聊啥大事，我讲了讲最近做的小项目，他们听得挺认真，还问我做到哪儿了。就是今天起来人有点累。',
    replies: ['他们还主动问起你的项目啊，听着挺暖的。', '我记得你 10 月 1 日也说过，聚会很开心，第二天却很累。会不会是聊天时一直提着劲，开心之余也有点耗神？'],
    hint: '连接之前的记录',
  },
  {
    user: '不是啦，跟他们待着挺放松的。回来又等车又换车，折腾了一个多小时，可能是路上累着了。',
    replies: ['啊，那我刚才猜偏了，跟他们聊天其实很放松。回程又等车又换车，确实折腾。', '还有件事我想问问：他们认真听你讲项目，会不会让你觉得，自己在做的事有人放在心上？'],
    hint: '纠正知知的理解',
  },
  {
    user: '对，就是这个感觉！项目还没做完，我本来以为没什么好讲的，但他们还挺感兴趣。一下觉得不是自己一个人在闷头折腾了。身体虽然累，心里倒是挺亮的。',
    replies: ['我记得你前天说，下一步先把首页做好。项目还没做完，朋友就已经愿意听你讲、问你的进展了。原来那些还在半路上的努力，也能被人看见。', '今天身体累，就先缓缓，项目等有精神了再接着做也行。'],
    hint: '从原话里，慢慢理解你',
  },
  {
    user: '嗯，今晚先不折腾了，早点休息。下次再约他们，回来的路也安排得轻松点哈哈。',
    replies: ['好呀，今晚就好好歇着，项目等有精神了再接着做。下次见朋友，回程也安排得轻松些。', '今天这一页，我留下了朋友认真听你讲项目的开心，也记着你说的：身体累，但心里挺亮的。'],
    hint: '翻开正反两面的画册',
  },
] as const

export const DEMO_ROUNDS = SCRIPT_ROUNDS.map(round => ({ ...round, reply: round.replies.join('') }))
export const NEXT_VISIT_DATE = '2026-10-05'
export const NEXT_VISIT_OPENING = '晚上好呀！昨天聊到朋友认真听你讲项目，你说心里挺亮的。今天想到那个还在半路的小项目，有没有一点新的想法？没做完也可以聊，我想听听。'
export const NEXT_VISIT_ROUND = {
  user: '今天改了一点首页，还是有点乱。不过想到他们昨天认真听我讲，没那么急着做出个完美版本了。先做一点，再慢慢改吧。',
  replies: ['昨天你说，项目还没做完，也有人愿意认真听。今天再说起它，听起来你给自己多留了一点余地。', '那就按你说的，先做一点，再慢慢改。我会把这次的新想法接在昨天那一页后面，想回看的时候，我们一起翻。'],
  hint: '让修正后的记录，接上下一次交流',
}
export function replyDuration(round: { replies: readonly string[] }): number {
  return REPLY_DELAY + (round.replies.length - 1) * REPLY_PART_DELAY
}

function message(id: string, role: DailyMessage['role'], text: string, date: string, minute: number, second = 0): DailyMessage {
  return { id, role, text, recordedAt: `${date}T08:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}Z` }
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

export function todayRecord(completed: number, pending = false, arrivedParts = 0): DailyRecord {
  const messages = [message('judge-opening', 'assistant', DEMO_OPENING, DEMO_DATE, 0)]
  DEMO_ROUNDS.forEach((round, index) => {
    if (index < completed || (index === completed && pending)) {
      messages.push(message(`judge-user-${index + 1}`, 'user', round.user, DEMO_DATE, index * 2 + 1))
    }
    const count = index < completed ? round.replies.length : index === completed && pending ? arrivedParts : 0
    round.replies.slice(0, count).forEach((text, part) => {
      messages.push(message(`judge-ai-${index + 1}${part ? `-part-${part + 1}` : ''}`, 'assistant', text, DEMO_DATE, index * 2 + 2, part))
    })
  })
  const corrected = completed >= 3
  const understood = completed >= 4
  return record(DEMO_DATE, messages, {
    title: completed === 0 ? '今天，等你留下一句话' : completed === 1 ? '好久没这么开心了'
      : understood ? '还没做完，也有人认真听' : '他们认真听我讲了小项目',
    diary: completed === 0 ? '' : completed === 1 ? '昨晚跟朋友吃饭，聊到很晚。好久没这么开心了。'
      : '昨晚跟朋友吃饭，讲了讲最近做的小项目。他们听得认真，还问起了进展。' +
        (understood ? '\n\n项目还没做完，也有人愿意听。那一刻，觉得自己没在一个人闷头折腾。' : '') +
        '\n\n今天身体有些累。' +
        (corrected ? '跟朋友待着其实很放松，回程却等车、换车，折腾了一个多小时，可能是路上累着了。' : '') +
        (understood ? '身体累，心里倒是挺亮的。' : '') +
        (completed >= 5 ? '\n\n今晚早点休息。下次还想见他们，也把回来的路安排得轻松一点。' : ''),
    portrait: {
      facts: completed === 0 ? [] : ['昨晚与朋友吃饭，聊到很晚。',
        ...(completed >= 2 ? ['向朋友讲了小项目；朋友认真听，并询问进展。', '自述今天起床后有些累。'] : []),
        ...(corrected ? ['返程等车、换车，历时一个多小时。'] : []),
        ...(understood ? ['项目尚未完成，用户原本以为没什么好讲的。'] : []),
        ...(completed >= 5 ? ['计划今晚早点休息，下次聚会把返程安排得轻松些。'] : [])],
      feelings: completed === 0 ? [] : ['与朋友相处时感到开心。',
        ...(corrected ? ['自述与朋友相处时放松。'] : []),
        ...(understood ? ['朋友对未完成的项目感兴趣，让用户觉得不再是独自闷头做事。', '自述“身体虽然累，心里倒是挺亮的”。'] : [])],
      observations: completed < 2 ? [] : [{
        text: corrected ? '根据用户补充，撤回“聊天时提着劲、聚会耗神”的猜测。用户认为可能是返程折腾导致疲惫，暂不确认因果。'
          : '暂定猜测：聊天时可能一直提着劲，聚会有些耗神。需要用户确认，不能作为确定结论。',
        evidenceIds: corrected ? ['judge-user-2', 'judge-user-3'] : ['judge-user-2'],
      }, {
        text: understood ? '用户已确认：这次开心与朋友认真倾听、关心未完成的项目有关，带来了努力被关注、有人同行的感受。仅描述这次经历，不推断长期性格或普遍需求。'
          : '暂定理解：朋友认真倾听、询问项目进展，可能让用户感到自己的努力被关注。尚待用户确认。',
        evidenceIds: understood ? ['judge-user-2', 'judge-user-4'] : ['judge-user-2'],
      }],
      uncertainties: completed === 0 ? [] : ['记录只覆盖主动分享的片段，不能代表完整的一天。',
        ...(completed >= 2 ? ['疲惫的具体原因尚未确认，不能从晚归时间或两次聚会后的疲惫直接推断因果。'] : []),
        ...(understood ? ['这次倾听带来的支持感，不代表用户每次做项目都需要陪伴或认可。'] : [])],
    },
  }, corrected ? 1 : 0)
}

export function demoMarkdown(record: DailyRecord): string {
  const revision = record.date === DEMO_DATE && record.revision >= 1
    ? '\n## 理解修订记录\n\n- 已撤回：聊天时提着劲、聚会耗神的猜测。\n- 用户补充：与朋友相处放松，回程等车、换车，历时一个多小时。\n- 仍待确认：疲惫可能与返程折腾有关，具体原因尚未确定。\n- 原话依据：judge-user-2、judge-user-3。\n' : ''
  return '> 预设示例：以下对话、日记与肖像均为合成内容，用于比赛演示；不代表实时模型生成或真实用户数据。\n\n' + serializeDailyRecord(record) + revision
}

export function nextVisitRecord(completed: boolean, pending = false, arrivedParts = 0): DailyRecord {
  const messages = [message('judge-next-opening', 'assistant', NEXT_VISIT_OPENING, NEXT_VISIT_DATE, 0)]
  if (completed || pending) messages.push(message('judge-next-user', 'user', NEXT_VISIT_ROUND.user, NEXT_VISIT_DATE, 1))
  NEXT_VISIT_ROUND.replies.slice(0, completed ? NEXT_VISIT_ROUND.replies.length : arrivedParts).forEach((text, index) =>
    messages.push(message(`judge-next-ai-${index + 1}`, 'assistant', text, NEXT_VISIT_DATE, 2, index)))
  const shared = completed || pending
  return record(NEXT_VISIT_DATE, messages, {
    title: shared ? '先做一点，再慢慢改' : '接着昨天，慢慢聊',
    diary: shared ? '今天改了一点首页，还没有理顺。\n\n想到朋友昨天认真听自己讲项目，没有那么急着做出一个完美版本了。先做一点，再慢慢改。' : '',
    portrait: {
      facts: shared ? ['今天修改了一点项目首页，仍觉得有些乱。'] : [],
      feelings: shared ? ['自述不再那么急着做出完美版本。'] : [],
      observations: shared ? [{ text: '用户提到昨天被朋友认真倾听的经历，并表达先做一点、再慢慢改的想法。仅描述这次变化。', evidenceIds: ['judge-next-user'] }] : [],
      uncertainties: ['这是一段预设的后续体验，未证明持续记忆后端已完成。', '没有分享昨晚是否休息，也不能据此推断项目已完成或形成长期习惯。'],
    },
  })
}
