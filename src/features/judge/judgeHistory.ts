import { createDailyRecord, type DailyRecord } from '../album/dailyRecord'

// Repeated fictional vignettes exercise a large archive. Never presented as user history.
const scenes = [
  ['雨停以后，绕了一小段路', '下班时雨刚停，绕到公园走了走。树叶上都是水珠，走完心情轻松了一点。', '雨停后去公园散步，心情轻松了一点。'],
  ['窗台上多了一点绿色', '给窗台的绿植换了一个花盆，还把桌子擦干净了。看着整齐的小角落，很满足。', '给绿植换盆、整理桌子，感到满足。'],
  ['把一个小问题解开了', '下午把项目里卡了很久的问题解决了。虽然只是一个小功能，还是很开心。', '解决了项目中的一个问题，感到开心。'],
  ['一顿不用赶时间的晚饭', '和朋友约了晚饭，聊了最近看的电影。没有赶时间，慢慢吃完才回家，很开心。', '与朋友吃晚饭、聊电影，感到开心。'],
  ['第一次摸到陶土', '去体验了陶艺，做出来的杯子有点歪。不过能用手做出一个东西，感觉很有趣。', '体验陶艺，觉得制作杯子很有趣。'],
  ['重新听到一首老歌', '坐公交时听到以前喜欢的歌，想起了大学的一次旅行。那段路突然变得很温柔。', '听老歌时想起大学旅行。'],
  ['桂花香，留在回家的路上', '回家路上闻到了桂花香，停下来找了一会儿，原来就在转角的院子里。这个小发现让我很开心。', '回程发现院子里的桂花，感到开心。'],
  ['给自己做了一碗面', '今天做了一碗番茄面，煎蛋有点糊，但热乎乎地吃完觉得很舒服。', '做番茄面，吃完觉得舒服。'],
  ['没有安排的一个下午', '下午没有安排，就在家读了几页书。读得不多，但是不用赶着做什么，很放松。', '在家读书，感到放松。'],
  ['修好台灯的小小成就', '把用了很久的台灯修好了。亮起来的一瞬间很有成就感，今晚又能坐在桌前看书了。', '修好台灯，感到有成就感。'],
  ['从一个不完美的开头开始', '给小项目画了第一版草图，不太满意，但终于有东西可以改了。心里踏实了一点。', '完成第一版草图，感到踏实了一点。'],
  ['把想念说给家人听', '晚上和家人打了电话，聊的都是小事。听到熟悉的声音，心里暖暖的。', '与家人通话，感到温暖。'],
] as const

export const HISTORY_RECORDS: DailyRecord[] = []
const end = Date.UTC(2026, 8, 25)
let index = 0
for (let timestamp = Date.UTC(2025, 0, 1); timestamp <= end; timestamp += 86_400_000) {
  const day = new Date(timestamp)
  // Four scattered days each week; gaps are normal and do not create empty pages.
  if (![0, 2, 4, 6].includes(day.getUTCDay())) continue
  const date = day.toISOString().slice(0, 10)
  const [title, quote, fact] = scenes[index++ % scenes.length]
  const userId = `judge-history-${date}-user`
  const record = createDailyRecord(date, [
    { id: userId, role: 'user', text: quote, recordedAt: `${date}T10:00:00Z` },
    { id: `judge-history-${date}-ai`, role: 'assistant', text: '这个片刻值得留下。我们就把你说的这些，放进今天这一页。', recordedAt: `${date}T10:00:02Z` },
  ])
  HISTORY_RECORDS.push({ ...record, title, diary: quote, portrait: {
    facts: [fact], feelings: [], observations: [],
    uncertainties: ['这是用于演示排版的合成片段，不能用来判断真实用户的习惯或性格。'],
  } })
}
