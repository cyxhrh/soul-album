import { useState } from 'react'
import { ChatAvatar } from '../free/ChatIdentity'
import type { DailyRecord } from '../album/dailyRecord'
import type { OpenSource } from './JudgeInsights'
import {
  DAILY_SAMPLES, DAILY_SOURCE_INFO, DAILY_SOURCE_KEYS,
  dailyValue, displayDailyValue, type DailySource, type DailyVisibility, type JudgeDailySample,
} from './judgeDailyData'
import './judge-daily.css'

type JudgeDailyProps = {
  completed: number
  record: DailyRecord
  onSource: OpenSource
  companionName: string
  companionSrc: string
  onChat: () => void
  onAlbum: () => void
}

function DailyIcon({ source }: { source: DailySource }) {
  return <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {source === 'steps' && <><path d="M8 4.5 6.5 8l1.7 4.5-2.7 3.3A2 2 0 0 0 7 19h3.5M13 5.5l3 4.5-.8 3.5 3.3 2.8A2 2 0 0 1 17 20h-3" /><path d="m8.2 12.5 4.3.5 2.7-3" /></>}
    {source === 'heartRate' && <><path d="M20 10.5C22 4 14.5 2 12 6 9.5 2 2 4 4 10.5 5.3 14.5 9 17 12 19c3-2 6.7-4.5 8-8.5Z" /><path d="M5.2 11h4l1.5-3.5 2.6 7 1.5-3.5h4" /></>}
    {source === 'spending' && <><path d="M4 6h14a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12v2" /><path d="M20 10h-5a2 2 0 0 0 0 4h5M15.5 12h.01" /></>}
  </svg>
}

function DailyChart({ source, selected }: { source: DailySource; selected: string }) {
  const info = DAILY_SOURCE_INFO[source]
  const maximum = Math.max(...DAILY_SAMPLES.map((sample) => dailyValue(sample, source)))
  return <>
    <div className="judge-daily-chart" role="img" aria-label={`${info.detail}七日图表，2026年9月28日至10月4日，单位${info.unit}，10月4日截至15:00。精确数值见下方表格。`}>
      {DAILY_SAMPLES.map((sample) => <div className={`judge-daily-chart-day${sample.date === selected ? ' selected' : ''}`} key={sample.date} aria-hidden="true">
        <span className="judge-daily-chart-value">{source === 'steps' ? Math.round(sample.steps).toString() : displayDailyValue(dailyValue(sample, source), source)}</span>
        <div className="judge-daily-chart-track"><span style={{ height: `${dailyValue(sample, source) / maximum * 100}%` }} /></div>
        <span>{sample.short}{sample.partial && '*'}</span>
      </div>)}
    </div>
    <p className="judge-daily-chart-note">* 今天只记录到下午，先不和完整的一天比较。</p>
    <details className="judge-daily-values" open>
      <summary>每日数值</summary>
      <table>
        <caption>{info.detail}每日数值</caption>
        <thead><tr><th scope="col">日期</th><th scope="col">记录</th></tr></thead>
        <tbody>{DAILY_SAMPLES.map((sample) => <tr key={sample.date} className={sample.date === selected ? 'selected' : undefined}>
          <th scope="row">{sample.label}{sample.partial && <small> · 至 {sample.through}</small>}</th>
          <td>{displayDailyValue(dailyValue(sample, source), source)} {info.unit}</td>
        </tr>)}</tbody>
      </table>
    </details>
  </>
}

function careForDay(sample: JudgeDailySample, visible: DailyVisibility, completed: number, record: DailyRecord): { text: string; extra?: string; basis: string; sourceIds?: string[] } {
  if (!DAILY_SOURCE_KEYS.some((source) => visible[source])) {
    return { text: '开启一个示例，看看这些日常记录如何呈现。想说的话，也可以随时回到对话里。', basis: '由你选择显示哪些示例' }
  }
  const hasUserQuote = (id: string) => record.date === sample.date && record.messages.some(message =>
    message.id === id && message.role === 'user' && message.text.trim() && message.recordedAt.startsWith(sample.date))
  if (sample.partial && completed >= 3 && hasUserQuote('judge-user-3')) {
    const confirmed = completed >= 4 && hasUserQuote('judge-user-2') && hasUserQuote('judge-user-4')
    return {
      text: '你说昨晚跟朋友待着很放松，是返程又等车又换车比较折腾。今天想慢一点也没关系，身体的感觉，你说了算。',
      extra: confirmed ? '朋友认真听你讲项目的那份开心，也不用被身体的疲惫盖过去。你说的“身体累，但心里挺亮的”，我也记着。' : undefined,
      basis: '疲惫的原因仍未确定',
      sourceIds: confirmed ? ['judge-user-2', 'judge-user-3', 'judge-user-4'] : ['judge-user-3'],
    }
  }
  if (visible.steps) {
    return {
      text: sample.partial ? '昨天走了不少路。今天到下午，想轻松待着，还是还没来得及出门？不用赶一个步数目标，按舒服的节奏来。'
        : `这一天留下了 ${displayDailyValue(sample.steps, 'steps')} 步。路上有没有遇到什么有意思的小事？走多少，都可以留下自己的片刻。`,
      basis: '来自步数示例 · 数字之外的感受，可以慢慢聊',
    }
  }
  if (visible.spending) {
    return {
      text: sample.partial ? '今天留下了一笔餐饮开销。有没有吃到喜欢的东西？那些普普通通的一餐，也可以是值得记住的小事。'
        : '这一天的开销，留在记录里。钱花在哪里是一种记录，当时的感受，也可以由你补上。',
      basis: '来自消费示例 · 不用金额评价你的选择',
    }
  }
  return { text: '身体的感觉，你比数字更清楚。想聊生活里的小事，或者今天只想歇一会儿，都可以。', basis: '心率只作记录，不作身体状态判断' }
}

export default function JudgeDaily({ completed, record, onSource, companionName, companionSrc, onChat, onAlbum }: JudgeDailyProps) {
  const [selectedDate, setSelectedDate] = useState(DAILY_SAMPLES[DAILY_SAMPLES.length - 1].date)
  const [visible, setVisible] = useState<DailyVisibility>({ steps: true, heartRate: true, spending: true })
  const [detail, setDetail] = useState<DailySource | null>(null)
  const sample = DAILY_SAMPLES.find((day) => day.date === selectedDate)!
  const care = careForDay(sample, visible, completed, record)

  function toggleSource(source: DailySource) {
    if (visible[source] && detail === source) setDetail(null)
    setVisible((current) => ({ ...current, [source]: !current[source] }))
  }

  return <div className="judge-daily-page">
    <header className="messenger-header">
      <div className="messenger-contact"><div><h1>日常</h1><p>生活的小细节，也值得被看见。</p></div></div>
      <span className="judge-badge">预设示例</span>
    </header>
    <div className="judge-daily-content">
      <div className="judge-daily-heading">
        <div><p className="judge-daily-eyebrow">日常的另一种记录</p><h2>{sample.label}，生活的一页</h2>
          <p className="judge-daily-time">{sample.partial ? `截至 ${sample.through} · 今天还在继续` : '当日记录 · 留下生活的细节'}</p>
        </div>
        <p className="judge-daily-sample-note"><span>合成示例数据</span><span>未连接真实设备或账单</span></p>
      </div>
      <nav className="judge-daily-date-nav" aria-label="日常记录日期">
        {DAILY_SAMPLES.map((day) => <button type="button" key={day.date} aria-label={`查看${day.date.replace(/^(\d+)-(\d+)-(\d+)$/, (_, year: string, month: string, date: string) => `${year}年${Number(month)}月${Number(date)}日`)}的日常`}
          aria-current={day.date === selectedDate ? 'date' : undefined} onClick={() => setSelectedDate(day.date)}>
          {day.short}{day.partial && <span>今天</span>}
        </button>)}
      </nav>

      <div className="judge-daily-metrics">
        {DAILY_SOURCE_KEYS.map((source) => {
          const info = DAILY_SOURCE_INFO[source]
          const enabled = visible[source]
          return <section className={`judge-daily-metric metric-${source}`} key={source} aria-label={info.title}>
            <div className="judge-daily-metric-top"><h3>{info.title}</h3><span className="judge-daily-icon"><DailyIcon source={source} /></span></div>
            <p className="judge-daily-number">{enabled ? <><strong>{displayDailyValue(dailyValue(sample, source), source)}</strong><span>{info.unit}</span></> : <strong className="judge-daily-hidden">未显示</strong>}</p>
            <p className="judge-daily-metric-note">{enabled ? info.note : '在数据来源里，可以重新显示这项示例。'}</p>
            <div className="judge-daily-metric-foot"><small>{info.source} · 合成示例</small>{enabled && <button type="button" aria-expanded={detail === source} aria-controls={`judge-daily-${source}-detail`} onClick={() => setDetail(detail === source ? null : source)}>查看{info.detail}明细<span aria-hidden="true"> ↗</span></button>}</div>
          </section>
        })}
      </div>

      {detail && visible[detail] && <section className="judge-daily-detail" id={`judge-daily-${detail}-detail`} aria-label={`${DAILY_SOURCE_INFO[detail].detail}七日明细`}>
        <div className="judge-daily-detail-heading"><div><p className="judge-daily-eyebrow">9 月 28 日 — 10 月 4 日 · 合成示例</p><h3>{DAILY_SOURCE_INFO[detail].title}的七天记录</h3></div>
          <button type="button" aria-label="收起日常明细" onClick={() => setDetail(null)}>收起 <span aria-hidden="true">↑</span></button></div>
        <p className="judge-daily-detail-source">来源：{DAILY_SOURCE_INFO[detail].source} · {detail === 'heartRate' ? '每日静息心率示例值，仅用于记录' : detail === 'spending' ? '本例仅含餐饮、交通与日用品记录' : '每日步数示例值，无打卡目标'}</p>
        <DailyChart source={detail} selected={selectedDate} />
        {detail === 'spending' && <div className="judge-daily-expenses"><h4>{sample.label}的开销</h4>
          <table><caption>{`${sample.date.replace(/^(\d+)-(\d+)-(\d+)$/, (_, year: string, month: string, date: string) => `${year}年${Number(month)}月${Number(date)}日`)}消费组成`}</caption>
            <thead><tr><th scope="col">类别</th><th scope="col">金额</th></tr></thead>
            <tbody>{sample.expenses.map((expense) => <tr key={expense.category}><th scope="row">{expense.category}</th><td>{displayDailyValue(expense.amount, 'spending')} 元</td></tr>)}</tbody>
            <tfoot><tr><th scope="row">合计</th><td>{displayDailyValue(dailyValue(sample, 'spending'), 'spending')} 元</td></tr></tfoot>
          </table>
          <p>只描述这些示例开销，不据此判断长期消费习惯。</p>
        </div>}
      </section>}

      <section className="judge-daily-care" aria-label={`${companionName}的一点关心`}>
        <ChatAvatar src={companionSrc} />
        <div><h3>{companionName}的一点关心</h3><p>{care.text}</p>{care.extra && <p>{care.extra}</p>}
          <div className="judge-daily-care-source">
            {care.sourceIds && <button type="button" className="judge-source-button" onClick={() => onSource(record, care.sourceIds!)}>来自你今天说的话<span aria-hidden="true"> ↗</span></button>}
            <small>{care.basis}</small>
          </div>
        </div>
      </section>

      <div className="judge-daily-bottom">
        <p>数字记下日常，画册留下你愿意说的故事。</p>
        <div className="judge-daily-actions"><button type="button" onClick={onChat}>回到对话</button><button type="button" onClick={onAlbum}>翻开今天的画册<span aria-hidden="true"> ↗</span></button></div>
      </div>
      <details className="judge-daily-sources">
        <summary>数据来源</summary>
        <div className="judge-daily-sources-content"><p>本页使用固定合成数据，展示未来可连接的生活记录。不读取手表、健康资料或支付账单，不获取设备权限，也不上传数据。这里的开关只控制示例显示。</p>
          <div className="judge-daily-source-toggles">{DAILY_SOURCE_KEYS.map((source) => <label key={source}>
            <input type="checkbox" aria-label={`显示${DAILY_SOURCE_INFO[source].detail}示例`} checked={visible[source]} onChange={() => toggleSource(source)} />
            <span>显示{DAILY_SOURCE_INFO[source].detail}示例<small>{DAILY_SOURCE_INFO[source].source}</small></span>
          </label>)}</div>
          <p>心率只作为一项记录；步数和金额也不能说明心情、健康或人格。数字不能确认疲惫的原因，关心的依据与用户自己的解释分开保留。</p>
          <p>日期与显示选择仅保留在本次页面体验中；重新体验会恢复初始示例。日常数据不会自动写入对话、肖像或画册文件。</p>
        </div>
      </details>
    </div>
  </div>
}
