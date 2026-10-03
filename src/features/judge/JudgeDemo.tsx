import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChatAvatar, ProductIcon } from '../free/ChatIdentity'
import { DEMO_DATE, DEMO_ROUNDS, PAST_RECORDS, REPLY_DELAY, demoMarkdown, todayRecord } from './judgeScript'
import type { DailyRecord } from '../album/dailyRecord'
import '../../styles/product.css'
import '../../styles/messenger.css'
import '../../styles/daily-album.css'
import './judge-demo.css'

function DemoAlbum({ record, corrected, onChat }: { record: DailyRecord; corrected: boolean; onChat: () => void }) {
  const [face, setFace] = useState<'front' | 'back'>('front')
  const markdown = demoMarkdown(record)
  function download() {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `渐知-示例-${record.date}.md`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className={`daily-album daily-album-${face}`} aria-label="每日画册">
    <div className="daily-toolbar">
      <div className="daily-face-switch" role="group" aria-label="画册正反面">
        <button type="button" aria-pressed={face === 'front'} onClick={() => setFace('front')}>日记正面</button>
        <button type="button" aria-pressed={face === 'back'} onClick={() => setFace('back')}>记录背面</button>
      </div>
      <span className="daily-status">{corrected ? '理解已纠正 · 原话保留' : '合成示例'}</span>
    </div>
    <article className="daily-paper">
      <header className="daily-heading"><p><span>{record.date.replaceAll('-', '.')}</span><span>{face === 'front' ? '生活日记' : '原话与今日肖像'}</span></p><h2>{record.title}</h2></header>
      {face === 'front' ? <div className="daily-prose">
        {record.diary ? record.diary.split('\n\n').map(paragraph => <p key={paragraph}>{paragraph}</p>)
          : <><p>不用从头讲起，从一个想留下的小片刻开始就好。</p><button className="judge-text-button" type="button" onClick={onChat}>回到对话，留下今天 ↗</button></>}
      </div> : <div className="daily-archive">
        <p className="daily-sample-note">对话、回复与肖像均为预设示例。原话与暂定理解分开保留。</p>
        <h3>完整对话 <span>{record.messages.length} 条</span></h3>
        {record.messages.map(message => <div className={`daily-message daily-message-${message.role}`} key={message.id}>
          <div><strong>{message.role === 'user' ? '用户原文' : '知知 · 示例回复'}</strong></div><p>{message.text}</p>
        </div>)}
        <section className="daily-portrait" aria-label="今日肖像">
          <h3>今日肖像 <span>可以被纠正的理解</span></h3>
          <h4>发生的事</h4>{record.portrait.facts.length ? <ul>{record.portrait.facts.map(text => <li key={text}>{text}</li>)}</ul> : <p>还没有分享今天的经历。</p>}
          <h4>自己说出的感受</h4>{record.portrait.feelings.map(text => <p key={text}>{text}</p>)}
          <h4>暂定观察与依据</h4>{record.portrait.observations.map(observation => <div className="daily-observation" key={observation.text}>
            <p>{observation.text}</p><details><summary>查看原话依据</summary>{observation.evidenceIds.map(id => <blockquote key={id}>{record.messages.find(message => message.id === id)?.text}</blockquote>)}</details>
          </div>)}
          <h4>还不确定的事</h4>{record.portrait.uncertainties.map(text => <p key={text}>{text}</p>)}
        </section>
        <details className="judge-markdown"><summary>查看 Markdown 源文件</summary><pre>{markdown}</pre></details>
      </div>}
      <footer className="daily-colophon"><span>{corrected ? '保留开心，也保留你补充的解释。' : '生活的片刻，慢慢装订成册。'}</span><span>渐知</span></footer>
    </article>
    <div className="daily-bottom"><div className="daily-actions"><button type="button" onClick={download}>下载 .md</button><button type="button" onClick={onChat}>回到对话</button></div><p className="daily-help">演示记录可以翻阅、查看和下载；真实版本支持编辑与修正。</p></div>
  </section>
}

/** Isolated, in-memory demo: never loads the real chat session or calls a model. */
export default function JudgeDemo() {
  const [tab, setTab] = useState<'chat' | 'album'>('chat')
  const [completed, setCompleted] = useState(0)
  const [pending, setPending] = useState(false)
  const [selectedDate, setSelectedDate] = useState(DEMO_DATE)
  const [run, setRun] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locked = useRef(false)
  const scroll = useRef<HTMLDivElement>(null)
  const sendButton = useRef<HTMLButtonElement>(null)
  const next = DEMO_ROUNDS[completed]
  const today = todayRecord(completed, pending)
  const records = [...PAST_RECORDS, today]
  const selected = records.find(record => record.date === selectedDate) ?? today
  const selectedIndex = records.indexOf(selected)

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
  useLayoutEffect(() => {
    if (tab === 'chat' && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [completed, pending, tab])

  function send() {
    if (locked.current || !next) return
    locked.current = true
    setPending(true)
    timer.current = setTimeout(() => {
      timer.current = null
      locked.current = false
      setCompleted(previous => previous + 1)
      setPending(false)
      sendButton.current?.focus({ preventScroll: true })
    }, REPLY_DELAY)
  }
  function reset() {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    locked.current = false
    setCompleted(0)
    setPending(false)
    setSelectedDate(DEMO_DATE)
    setTab('chat')
    setRun(previous => previous + 1)
  }
  function openToday() { setSelectedDate(DEMO_DATE); setTab('album') }

  return <main className={`product-shell judge-demo product-tab-${tab}`} aria-label="渐知示例体验">
    <nav className="product-nav" aria-label="产品导航">
      <div className="product-brand"><span className="product-brand-mark" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}brand/jianzhi-sprout.svg`} alt="" width="36" height="36" /></span><strong>渐知</strong><small>慢慢认识你</small></div>
      <div className="product-nav-links">
        <button type="button" aria-current={tab === 'chat' ? 'page' : undefined} onClick={() => setTab('chat')}><ProductIcon name="chat" /><span>对话</span></button>
        <button type="button" aria-current={tab === 'album' ? 'page' : undefined} onClick={() => setTab('album')}><ProductIcon name="album" /><span>画册</span></button>
      </div>
      <div className="judge-nav-note"><p>从一句话开始，<br />慢慢认识你。</p><small>示例体验 · 无需登录</small></div>
    </nav>
    <div className="product-workspace">
      <div className="product-content">
        {tab === 'chat' ? <section className="product-chat" aria-label="对话记录">
          <header className="messenger-header"><div className="messenger-contact"><ChatAvatar /><div><h1>知知</h1><p>AI 记录伙伴</p></div></div><div className="judge-header-actions"><span className="judge-badge">预设示例</span><button type="button" onClick={reset}>重新体验</button></div></header>
          <div className="judge-intro"><p>用四次发送，体验一段被记住、也能被纠正的对话。</p><span>所有内容均为合成示例，点击发送即可继续。</span></div>
          <div className="product-chat-scroll" ref={scroll}>
            <p className="product-day-divider">10 月 4 日 · 下午</p>
            <div className="product-thread">
              {today.messages.map(message => <div className={`product-bubble-row ${message.role === 'user' ? 'user' : 'agent'}`} key={message.id}>
                {message.role !== 'user' && <ChatAvatar />}<div className="product-bubble"><p>{message.text}</p></div>{message.role === 'user' && <ChatAvatar user />}
              </div>)}
              {pending && <div className="product-bubble-row agent" role="status"><ChatAvatar /><div className="product-bubble"><span className="product-typing-dots" aria-hidden="true"><i /><i /><i /></span><span className="product-sr-title">知知正在输入</span></div></div>}
              {completed >= 3 && !pending && <div className="judge-record-link"><span>{completed === DEMO_ROUNDS.length ? '这一页已留下' : '画册里的理解已更新'}</span><button type="button" onClick={openToday}>翻开今天的画册 ↗</button></div>}
            </div>
          </div>
          <div className="product-chat-controls">
            {next ? <div className="product-composer" data-voice-state="idle"><div className="product-composer-input"><textarea aria-label="预设消息" readOnly value={next.user} rows={2} /></div><button type="button" className="product-send" ref={sendButton} disabled={pending} onClick={send}>发送</button><p className="messenger-input-hint"><span role="status">{pending ? '知知正在输入…' : next.hint}</span><span>{Math.min(completed + 1, DEMO_ROUNDS.length)} / {DEMO_ROUNDS.length}</span></p></div>
              : <div className="judge-complete" role="status"><div><strong>谢谢你，愿意说给我听。</strong><p>翻开画册，看看今天留下了什么。</p></div><button type="button" className="product-send" onClick={openToday}>查看画册</button></div>}
          </div>
        </section> : <section className="judge-album-view" aria-label="画册记录">
          <header className="messenger-header"><div className="messenger-contact"><div><h1>日常，慢慢成册</h1><p>正面留下一天，背面保留原话与理解。</p></div></div><div className="judge-header-actions"><span className="judge-badge">预设示例</span><button type="button" onClick={reset}>重新体验</button></div></header>
          <div className="judge-album-wrap"><div className="judge-date-nav" role="group" aria-label="选择画册日期">{records.map(record => <button type="button" key={record.date} aria-pressed={selectedDate === record.date} onClick={() => setSelectedDate(record.date)}>{record.date.slice(5).replace('-', '.')} {record.date === DEMO_DATE && <small>今天</small>}</button>)}</div>
            <DemoAlbum key={`${run}-${selectedDate}`} record={selected} corrected={selectedDate === DEMO_DATE && completed >= 3} onChat={() => setTab('chat')} />
            <div className="judge-page-nav"><button type="button" disabled={selectedIndex === 0} onClick={() => setSelectedDate(records[selectedIndex - 1].date)}>← 前一页</button><span>{selectedIndex + 1} / {records.length}</span><button type="button" disabled={selectedIndex === records.length - 1} onClick={() => setSelectedDate(records[selectedIndex + 1].date)}>后一页 →</button></div>
          </div>
        </section>}
      </div>
    </div>
  </main>
}
