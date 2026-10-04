import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChatAvatar, COMPANIONS, companionImage, MicrophoneIcon, ProductIcon } from '../free/ChatIdentity'
import { DEMO_DATE, DEMO_OPENING, DEMO_ROUNDS, NEXT_VISIT_DATE, NEXT_VISIT_OPENING, NEXT_VISIT_ROUND, PAST_RECORDS, REPLY_DELAY, REPLY_PART_DELAY, demoMarkdown, nextVisitRecord, todayRecord } from './judgeScript'
import type { DailyRecord } from '../album/dailyRecord'
import type { DailyMessage } from '../../../shared/dailyAlbum'
import AlbumLibrary from '../album/AlbumLibrary'
import { HISTORY_RECORDS } from './judgeHistory'
import { JudgeCall, JudgeCompanionPicker, PresetVoiceWave } from './JudgeExperience'
import { AIPractice, SourceDialog, UnderstandingUpdate, type OpenSource, type SourceSelection } from './JudgeInsights'
import JudgeDaily from './JudgeDaily'
import '../../styles/product.css'
import '../../styles/messenger.css'
import '../../styles/daily-album.css'
import './judge-demo.css'

const MESSAGE_STICKERS: Record<string, { file: string; alt: string }> = {
  'judge-ai-1': { file: 'happy.png', alt: '知知开心地跳起来' },
  'judge-ai-5': { file: 'sleepy.png', alt: '知知揉揉眼睛，准备休息' },
}

function ChatMessage({ message, src, active, firstAppearance, showStickers }: { message: DailyMessage; src: string; active: boolean; firstAppearance: boolean; showStickers: boolean }) {
  const [entering, setEntering] = useState(() => active && firstAppearance && message.id !== 'judge-opening' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const sticker = showStickers ? MESSAGE_STICKERS[message.id] : undefined
  useEffect(() => { if (!active) setEntering(false) }, [active])
  return <><div className={`product-bubble-row ${message.role === 'user' ? 'user' : 'agent'}${entering ? ' judge-message-enter' : ''}`}>
    {message.role !== 'user' && <ChatAvatar src={src} />}
    <div className="product-bubble" onAnimationEnd={event => {
      if (event.target === event.currentTarget) setEntering(false)
    }}><p>{message.text}</p></div>
    {message.role === 'user' && <ChatAvatar user />}
  </div>{sticker && <div className={`judge-sticker-message${entering ? ' judge-sticker-enter' : ''}`}>
    <ChatAvatar src={src} />
    <img className="judge-sticker-image" src={`${import.meta.env.BASE_URL}brand/stickers/${sticker.file}`} alt={sticker.alt} width="136" height="136" decoding="async" />
  </div>}</>
}

function DemoAlbum({ record, corrected, onChat, companionName, onSource, onNextVisit }: { record: DailyRecord; corrected: boolean; onChat: () => void; companionName: string; onSource: OpenSource; onNextVisit?: () => void }) {
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
      <div className="daily-face-switch" role="group" aria-label="画册阅读方式">
        <button type="button" aria-pressed={face === 'front'} onClick={() => setFace('front')}>日常小记</button>
        <button type="button" aria-pressed={face === 'back'} onClick={() => setFace('back')}>原话与理解</button>
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
        <section className="daily-portrait" aria-label="今日肖像">
          <h3>今日肖像 <span>从你说过的话里，慢慢理解</span></h3>
          <div className="judge-portrait-summary"><div><h4>今天的片刻</h4><p>{record.portrait.facts.slice(0, 2).join('') || '还没有分享今天的经历。'}</p></div><div><h4>你说出的感受</h4><p>{record.portrait.feelings.join('') || '还没有表达今天的感受，不急着猜。'}</p></div></div>
          {corrected && <UnderstandingUpdate record={record} confirmed={record.messages.some(message => message.id === 'judge-user-4')} onSource={onSource} />}
          <details className="judge-portrait-detail"><summary>更多观察与原话依据</summary>
          <h4>发生的事</h4>{record.portrait.facts.length ? <ul>{record.portrait.facts.map(text => <li key={text}>{text}</li>)}</ul> : <p>还没有分享今天的经历。</p>}
          <h4>自己说出的感受</h4>{record.portrait.feelings.map(text => <p key={text}>{text}</p>)}
          <h4>暂定观察与依据</h4>{record.portrait.observations.map(observation => <div className="daily-observation" key={observation.text}>
            <span className="judge-insight-status">{observation.text.includes('撤回') ? '已修正' : observation.text.startsWith('用户已确认') ? '已确认' : '暂定观察'}</span><p>{observation.text}</p><details><summary>查看原话依据</summary>{observation.evidenceIds.map(id => <blockquote key={id}>{record.messages.find(message => message.id === id)?.text}</blockquote>)}</details><button type="button" className="judge-source-button" onClick={() => onSource(record, observation.evidenceIds)}>打开原话 ↗</button>
          </div>)}
          <h4>还不确定的事</h4>{record.portrait.uncertainties.map(text => <p key={text}>{text}</p>)}
          </details>
        </section>
        <details className="judge-transcript"><summary>完整对话 · {record.messages.length} 条</summary>
          {record.messages.map(message => <div className={`daily-message daily-message-${message.role}`} key={message.id}>
            <div><strong>{message.role === 'user' ? '用户原文' : `${companionName} · 示例回复`}</strong></div><p>{message.text}</p>
          </div>)}
        </details>
        <details className="judge-markdown"><summary>查看 Markdown 源文件</summary><pre>{markdown}</pre></details>
      </div>}
      <footer className="daily-colophon"><span>{corrected ? '认真听见的，都留在这一页。' : '生活的片刻，慢慢装订成册。'}</span><span>渐知</span></footer>
    </article>
    <div className="daily-bottom"><div className="daily-actions"><button type="button" onClick={download}>下载 .md</button><button type="button" onClick={onChat}>回到对话</button>{onNextVisit && <button type="button" className="daily-primary" onClick={onNextVisit}>体验下一次见面</button>}</div><p className="daily-help">演示记录可以翻阅、核对理解变化和下载；下一次见面同样为预设体验。</p></div>
  </section>
}

/** Isolated, in-memory demo: never loads the real chat session or calls a model. */
export default function JudgeDemo() {
  const [tab, setTab] = useState<'chat' | 'album' | 'daily'>('chat')
  const [completed, setCompleted] = useState(0)
  const [pending, setPending] = useState(false)
  const [arrivedParts, setArrivedParts] = useState(0)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [run, setRun] = useState(0)
  const [companionId, setCompanionId] = useState('zhizhi')
  const [callOpen, setCallOpen] = useState(false)
  const [voicePreview, setVoicePreview] = useState<'idle' | 'preview' | 'ready'>('idle')
  const [visitStarted, setVisitStarted] = useState(false)
  const [visitOpen, setVisitOpen] = useState(false)
  const [visitCompleted, setVisitCompleted] = useState(false)
  const [source, setSource] = useState<SourceSelection | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locked = useRef(false)
  const scroll = useRef<HTMLDivElement>(null)
  const sendButton = useRef<HTMLButtonElement>(null)
  const messageInput = useRef<HTMLTextAreaElement>(null)
  const callEntry = useRef<HTMLButtonElement>(null)
  const voiceEntry = useRef<HTMLButtonElement>(null)
  const detailsDialog = useRef<HTMLDialogElement>(null)
  const seenMessages = useRef(new Set<string>())
  const companion = COMPANIONS.find(item => item.id === companionId) ?? COMPANIONS[0]
  const companionSrc = companionImage(companion.id)
  const next = visitOpen ? visitCompleted ? undefined : NEXT_VISIT_ROUND : DEMO_ROUNDS[completed]
  const today = todayRecord(completed, pending && !visitOpen, visitOpen ? 0 : arrivedParts)
  const visit = nextVisitRecord(visitCompleted, pending && visitOpen, visitOpen ? arrivedParts : 0)
  const currentChat = visitOpen ? visit : today
  const records = [...HISTORY_RECORDS, ...PAST_RECORDS, today, ...(visitStarted ? [visit] : [])]
  const lastUser = currentChat.messages.filter(message => message.role === 'user').at(-1)?.text
  const lastReply = visitOpen ? visitCompleted ? NEXT_VISIT_ROUND.replies.join('') : NEXT_VISIT_OPENING : completed ? DEMO_ROUNDS[completed - 1].reply : DEMO_OPENING
  const openSource: OpenSource = (record, ids) => setSource({ record, ids })

  useLayoutEffect(() => { currentChat.messages.forEach(message => seenMessages.current.add(message.id)) })

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
  useLayoutEffect(() => {
    if (tab === 'chat' && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [completed, pending, arrivedParts, tab, callOpen, visitOpen, visitCompleted, companionId])
  useLayoutEffect(() => {
    const input = messageInput.current
    if (!input || voicePreview === 'preview') return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 144)}px`
  }, [completed, voicePreview, tab, callOpen, visitOpen, visitCompleted])

  function changeTab(nextTab: 'chat' | 'album' | 'daily') { setVoicePreview('idle'); setTab(nextTab) }
  function openCall() { setVoicePreview('idle'); setCallOpen(true) }
  function closeCall() {
    setCallOpen(false)
    window.requestAnimationFrame(() => callEntry.current?.focus())
  }
  function finishVoicePreview() {
    setVoicePreview('ready')
    window.requestAnimationFrame(() => voiceEntry.current?.focus())
  }

  function send() {
    if (locked.current || !next) return
    const replies = next.replies
    const followUp = visitOpen
    locked.current = true
    setVoicePreview('idle')
    setArrivedParts(0)
    setPending(true)
    function deliver(part: number) {
      if (part < replies.length - 1) {
        setArrivedParts(part + 1)
        timer.current = setTimeout(() => deliver(part + 1), REPLY_PART_DELAY)
        return
      }
      timer.current = null
      locked.current = false
      setArrivedParts(0)
      if (followUp) setVisitCompleted(true)
      else setCompleted(previous => previous + 1)
      setPending(false)
      if (!sendButton.current?.closest('[hidden]')) sendButton.current?.focus({ preventScroll: true })
    }
    timer.current = setTimeout(() => deliver(0), REPLY_DELAY)
  }
  function reset() {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    locked.current = false
    seenMessages.current.clear()
    setCompleted(0)
    setPending(false)
    setArrivedParts(0)
    setSelectedDate(null)
    setCallOpen(false)
    setVoicePreview('idle')
    setVisitStarted(false)
    setVisitOpen(false)
    setVisitCompleted(false)
    setSource(null)
    setTab('chat')
    setRun(previous => previous + 1)
  }
  function openToday() { setCallOpen(false); setVoicePreview('idle'); setSelectedDate(visitOpen ? NEXT_VISIT_DATE : DEMO_DATE); setTab('album') }
  function openNextVisit() {
    if (pending || completed !== DEMO_ROUNDS.length) return
    setVisitStarted(true); setVisitOpen(true); setSelectedDate(null); setVoicePreview('idle'); setCallOpen(false); setTab('chat')
  }

  return <main className={`product-shell judge-demo product-tab-${tab}${callOpen ? ' product-shell-call' : ''}`} aria-label="渐知示例体验">
    <nav className="product-nav" aria-label="产品导航" hidden={callOpen}>
      <div className="product-brand"><span className="product-brand-mark" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}brand/jianzhi-sprout.svg`} alt="" width="36" height="36" /></span><strong>渐知</strong><small>慢慢认识你</small></div>
      <div className="product-nav-links">
        <button type="button" aria-current={tab === 'chat' ? 'page' : undefined} onClick={() => changeTab('chat')}><ProductIcon name="chat" /><span>对话</span></button>
        <button type="button" aria-current={tab === 'album' ? 'page' : undefined} onClick={() => changeTab('album')}><ProductIcon name="album" /><span>画册</span></button>
        <button type="button" aria-current={tab === 'daily' ? 'page' : undefined} onClick={() => changeTab('daily')}><ProductIcon name="data" /><span>日常</span></button>
      </div>
      <div className="judge-nav-note"><p>从一句话开始，<br />慢慢认识你。</p><small>示例体验 · 无需登录</small></div>
      <div className="product-nav-foot"><button type="button" className="product-clear" onClick={reset}>重新体验</button><button type="button" className="product-details-trigger" onClick={() => detailsDialog.current?.showModal()}>详情 <span aria-hidden="true">↗</span></button></div>
    </nav>
    <div className="product-workspace">
      <div className="product-content">
        {callOpen && <JudgeCall name={companion.name} src={companionSrc} label={companion.label} nextText={next?.user} lastReply={lastReply} lastUser={lastUser} pending={pending} onSend={send} onClose={closeCall} />}
        <section className="product-chat" aria-label="对话记录" hidden={tab !== 'chat' || callOpen}>
          <header className="messenger-header"><div className="messenger-contact"><ChatAvatar src={companionSrc} /><div><h1>{companion.name}</h1><p>AI 记录伙伴</p></div></div><div className="messenger-header-actions"><span className="messenger-offline">预设示例</span><JudgeCompanionPicker id={companionId} onSelect={setCompanionId} /><details className="product-settings"><summary aria-label="聊天设置" title="聊天设置">聊天设置<ProductIcon name="more" /></summary><div className="messenger-settings-panel"><h2>聊天设置</h2><p>预设示例 · 消息与回复按固定流程推进。</p><button type="button" onClick={reset}>重置这段对话</button></div></details></div></header>
          <div className="judge-intro"><p>{visitOpen ? '下一次见面：用昨天修正后的记录，接上今天的话。' : `用 ${DEMO_ROUNDS.length} 次发送，体验被记住、被理解，也能纠正知知的对话。`}</p><span>所有内容均为合成示例，点击发送即可继续。</span>{visitOpen && <button type="button" className="judge-source-button" disabled={pending} onClick={() => setVisitOpen(false)}>← 回看昨天的对话</button>}{!visitOpen && visitStarted && <button type="button" className="judge-source-button" disabled={pending} onClick={openNextVisit}>接着下一次见面 ↗</button>}</div>
          <div className="product-chat-scroll" ref={scroll}>
            <p className="product-day-divider">{visitOpen ? '10 月 5 日 · 晚上 · 预设后续片段' : '10 月 4 日 · 下午'}</p>
            <div className="product-thread">
              {currentChat.messages.map(message => <Fragment key={message.id}>
                <ChatMessage message={message} src={companionSrc} active={tab === 'chat' && !callOpen} firstAppearance={!seenMessages.current.has(message.id)} showStickers={companionId === 'zhizhi'} />
                {message.id === 'judge-ai-2-part-2' && <div className="judge-message-source"><button type="button" className="judge-source-button" aria-label="查看 10月1日的原话" onClick={() => openSource(PAST_RECORDS[1], ['judge-past-2-user'])}>来自 10月1日的记录 ↗</button></div>}
                {message.id === 'judge-ai-4' && <div className="judge-message-source"><button type="button" className="judge-source-button" aria-label="查看 10月2日的原话" onClick={() => openSource(PAST_RECORDS[2], ['judge-past-3-user'])}>来自 10月2日的记录 ↗</button></div>}
                {message.id === 'judge-ai-3-part-2' && completed >= 3 && <UnderstandingUpdate record={today} confirmed={completed >= 4} onSource={openSource} />}
                {message.id === 'judge-next-opening' && <div className="judge-message-source"><button type="button" className="judge-source-button" aria-label="查看昨天修正后的原话" onClick={() => openSource(today, ['judge-user-3', 'judge-user-4'])}>接着 10月4日修正后的记录 ↗</button></div>}
              </Fragment>)}
              {pending && <div className="product-bubble-row agent" role="status"><ChatAvatar src={companionSrc} /><div className="product-bubble"><span className="product-typing-dots" aria-hidden="true"><i /><i /><i /></span><span className="product-sr-title">{companion.name}正在输入</span></div></div>}
              {(visitOpen ? visitCompleted : completed >= 3) && !pending && <div className="judge-record-link"><span>{visitOpen || completed === DEMO_ROUNDS.length ? '这一页已留下' : '画册里的理解已更新'}</span><button type="button" onClick={openToday}>翻开今天的画册 ↗</button></div>}
            </div>
          </div>
          <div className="product-chat-controls">
            {next ? <div className="product-composer" data-voice-state={voicePreview === 'preview' ? 'recording' : 'idle'}>
              <div className="product-composer-input">
                {voicePreview === 'preview' ? <div className="product-voice-panel" aria-label="语音输入示例">
                  <PresetVoiceWave />
                  <div className="product-voice-panel-foot"><span className="product-recording-label"><i aria-hidden="true" />聆听中 · 预设体验</span><button type="button" className="product-voice-text-action" aria-label="停止聆听并放弃本次语音" onClick={() => { setVoicePreview('idle'); voiceEntry.current?.focus() }}>停止聆听</button></div>
                </div> : <textarea ref={messageInput} aria-label="预设消息" readOnly value={next.user} rows={1} />}
              </div>
              <div className="product-composer-toolbar"><div className="product-composer-actions">
                <button type="button" className="product-call-entry" ref={callEntry} disabled={pending || voicePreview === 'preview'} aria-label="语音对话" title="语音对话 · 预设交互演示，无需录音" onClick={openCall}><ProductIcon name="phone" /></button>
                <button type="button" className="product-voice" ref={voiceEntry} disabled={pending} aria-label={voicePreview === 'preview' ? '结束聆听并转成文字' : '开始语音输入'} title="语音输入示例" aria-pressed={voicePreview === 'preview'} onClick={() => voicePreview === 'preview' ? finishVoicePreview() : setVoicePreview('preview')}>{voicePreview === 'preview' ? <span className="product-voice-stop" aria-hidden="true" /> : <MicrophoneIcon />}</button>
                <button type="button" className="product-send" ref={sendButton} disabled={pending || voicePreview === 'preview'} onClick={send}>发送</button>
              </div></div>
              <p className="messenger-input-hint"><span role="status">{pending ? `${companion.name}正在输入…` : voicePreview === 'ready' ? '示例已放入输入框，点击发送继续' : next.hint}</span><span>{visitOpen ? '后续片段 · 1 / 1' : `${Math.min(completed + 1, DEMO_ROUNDS.length)} / ${DEMO_ROUNDS.length}`}</span></p>
              {voicePreview !== 'idle' && <p className="product-composer-note" role="status">预设语音流程 · 无需录音，完成后点击发送继续。</p>}
            </div> : <div className="judge-complete" role="status"><div><strong>{visitOpen ? '这次的新想法，也接在昨天后面了。' : '谢谢你，愿意说给我听。'}</strong><p>翻开画册，看看今天留下了什么。</p></div><div className="judge-complete-actions"><button type="button" className="product-call-entry" ref={callEntry} aria-label="语音对话" title="语音对话 · 预设交互演示，无需录音" onClick={openCall}><ProductIcon name="phone" /></button><button type="button" className="product-send" onClick={openToday}>查看画册</button></div></div>}
          </div>
        </section><section className="judge-album-view" aria-label="画册记录" hidden={tab !== 'album'}>
          <header className="messenger-header"><div className="messenger-contact"><div><h1>日常，慢慢成册</h1><p>正面留下一天，背面保留原话与理解。</p></div></div><div className="judge-header-actions"><span className="judge-badge">预设示例</span></div></header>
          <AlbumLibrary key={run} records={records} todayDate={DEMO_DATE} selectedDate={selectedDate} active={tab === 'album'} onSelect={setSelectedDate}
            renderRecord={record => <DemoAlbum key={record.date} record={record} corrected={record.date === DEMO_DATE && completed >= 3} companionName={companion.name} onChat={() => { if (!pending) setVisitOpen(record.date === NEXT_VISIT_DATE); changeTab('chat') }} onSource={openSource} onNextVisit={record.date === DEMO_DATE && completed === DEMO_ROUNDS.length && !pending ? openNextVisit : undefined} />} />
        </section>
        <section className="judge-daily-view screen-only" aria-label="日常生活记录" hidden={tab !== 'daily' || callOpen}>
          <JudgeDaily key={run} completed={completed} companionName={companion.name} companionSrc={companionSrc} onChat={() => changeTab('chat')} onAlbum={() => { setSelectedDate(DEMO_DATE); changeTab('album') }} />
        </section>
      </div>
    </div>
    <SourceDialog selection={source} onClose={() => setSource(null)} />
    <dialog ref={detailsDialog} className="free-print-dialog product-details-dialog screen-only" aria-labelledby="judge-details-title"><p className="guided-section-index">渐知 · 有长期记忆的 AI 生活伙伴</p><h2 id="judge-details-title">关于这个演示</h2><dl><div><dt>怎样体验</dt><dd>点击发送推进五轮预设对话，核对理解变化，再翻开画册体验下一次见面；形象选择、电话和语音输入沿用原来的界面。</dd></div><div><dt>内容与语音</dt><dd>对话、画册与肖像是合成示例。语音按预设内容展示，不调用麦克风、识别服务或模型接口，也不播放声音。</dd></div><div><dt>日常记录</dt><dd>步数、静息心率和消费均为固定合成数据，可以按日期查看明细、单独隐藏来源。尚未连接手表或账单；数值不用于诊断健康或判断心情。</dd></div><div><dt>画册与保存</dt><dd>可以按月翻阅、查看原话依据并下载 .md。演示只保留本页进度，不读取个人聊天缓存；刷新或重新体验会从头开始。</dd></div></dl><AIPractice /><button type="button" className="product-details-close" onClick={() => detailsDialog.current?.close()}>知道了</button></dialog>
  </main>
}
