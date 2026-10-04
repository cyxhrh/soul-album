import { useLayoutEffect, useRef, useState } from 'react'
import {
  cadenceForDay, changeCadence, createInvitationState, isInvitationDue,
  markInvitationShown, pauseInvitations, resumeInvitations, settleInvitation,
  shareProactively, type Cadence, type InvitationState,
} from '../../domain/invitations'
import { titleDaysAffectedByEntryChange, type Entry } from '../../domain/journal'
import { createBrowserLocalSession } from '../../domain/browserLocalSession'
import { classifyChatIntent } from '../../domain/chatIntent'
import { selectAlbum, selectAnsweredQuestions, selectComparison } from '../../domain/selectors'
import AlbumPage from '../album/AlbumPage'
import DataInsights, { type BehaviorConsents, type BehaviorSource } from '../data/DataInsights'
import '../../styles/product.css'

const DAYS = [1, 2, 8, 9] as const
const cadenceLabel: Record<Cadence, string> = {
  daily: '每日两问', weekly: '每周一问', manual: '仅我主动',
}
type EntryChange =
  | { kind: 'editEntry'; id: string; text: string; affectedTitleDays: number[]; preflightUpdated?: boolean }
  | { kind: 'deleteEntry'; id: string; affectedTitleDays: number[]; preflightUpdated?: boolean }
type ProductTab = 'chat' | 'album' | 'data'
type ControlExchange = { id: string; reply: string; promptQuestionId?: string }
type TimelineItem = { kind: 'entry'; order: number; entry: Entry } |
  { kind: 'control'; order: number; exchange: ControlExchange; text: string }

function nextDueDay(state: InvitationState, afterDay: number): number | null {
  for (let future = afterDay + 1; future <= afterDay + 28; future++) {
    if (isInvitationDue(state, future)) return future
  }
  return null
}

function FreeSession({ onReset }: { onReset: () => void }) {
  const [session] = useState(() => createBrowserLocalSession())
  const [snapshot, setSnapshot] = useState(() => session.read())
  const journal = session.projectJournal(snapshot)
  const [activeTab, setActiveTab] = useState<ProductTab>('chat')
  const [controlExchanges, setControlExchanges] = useState<ControlExchange[]>([])
  const [consents, setConsents] = useState<BehaviorConsents>({ steps: false, spending: false, screenTime: false })
  const [invitation, setInvitation] = useState(() => markInvitationShown(createInvitationState(), 1))
  const [day, setDay] = useState(1)
  const [viewedDay, setViewedDay] = useState(1)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answeredInRound, setAnsweredInRound] = useState(false)
  const [extraQuestion, setExtraQuestion] = useState(false)
  const [thirdUsed, setThirdUsed] = useState(false)
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(session.firstQuestionId)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [choice, setChoice] = useState<Cadence>('daily')
  const [status, setStatus] = useState('')
  const [printPending, setPrintPending] = useState(false)
  const [pendingEntryChange, setPendingEntryChange] = useState<EntryChange | null>(null)
  const printDialogRef = useRef<HTMLDialogElement>(null)
  const printOpenerRef = useRef<HTMLElement | null>(null)
  const titleConfirmRef = useRef<HTMLDialogElement>(null)
  const titleConfirmOpenerRef = useRef<HTMLElement | null>(null)
  const titleConfirmFocusReturnRef = useRef<'opener' | 'status' | null>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!printPending) {
      if (printOpenerRef.current?.isConnected) printOpenerRef.current.focus()
      printOpenerRef.current = null
      return
    }
    const dialog = printDialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
    buttons[0]?.focus()
    function containTab(event: KeyboardEvent) {
      if (event.key !== 'Tab' || buttons.length === 0) return
      const active = document.activeElement
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && (active === first || !dialog!.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog!.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', containTab, true)
    return () => {
      document.removeEventListener('keydown', containTab, true)
      if (dialog.open) dialog.close()
    }
  }, [printPending])

  function closePrintReminder() {
    if (printDialogRef.current?.open) printDialogRef.current.close()
    setPrintPending(false)
  }

  function openPrintReminder() {
    printOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPrintPending(true)
  }

  const titleConfirmationOpen = pendingEntryChange !== null
  useLayoutEffect(() => {
    if (!titleConfirmationOpen) {
      const destination = titleConfirmFocusReturnRef.current
      if (!destination) return
      const opener = titleConfirmOpenerRef.current
      const statusTarget = statusRef.current
      const fallback = document.querySelector<HTMLButtonElement>('.free-day-nav button[aria-current="date"]')
      const target = destination === 'opener' && opener?.isConnected ? opener :
        statusTarget?.isConnected ? statusTarget : fallback
      target?.focus()
      titleConfirmFocusReturnRef.current = null
      titleConfirmOpenerRef.current = null
      return
    }
    const dialog = titleConfirmRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
    buttons[0]?.focus()
    function containTab(event: KeyboardEvent) {
      if (event.key !== 'Tab' || buttons.length === 0) return
      const active = document.activeElement
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && (active === first || !dialog!.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog!.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', containTab, true)
    return () => {
      document.removeEventListener('keydown', containTab, true)
      if (dialog.open) dialog.close()
    }
  }, [titleConfirmationOpen])

  function showTitleConfirmation(change: EntryChange) {
    if (!pendingEntryChange) {
      titleConfirmOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    setPendingEntryChange(change)
  }

  function closeTitleConfirmation() {
    titleConfirmFocusReturnRef.current = 'opener'
    setPendingEntryChange(null)
  }

  const cadence = cadenceForDay(invitation, day)
  const roundClosed = invitation.settledDays.includes(day)
  const due = isInvitationDue(invitation, day) && !roundClosed
  const questionCount = cadence === 'weekly' ? 1 : 2
  const activeQuestion = snapshot.questions.find((question) => question.id === activeQuestionId)
  const visibleQuestionText = activeQuestion?.text ?? ''
  const recordedDays = [...new Set(journal.entries.map((entry) => entry.day))]
    .sort((first, second) => first - second)
  const albumDay = recordedDays.includes(viewedDay) ? viewedDay : recordedDays.at(-1) ?? day
  const album = selectAlbum(journal, albumDay)
  const selectedDayIndex = recordedDays.indexOf(albumDay)
  const comparison = selectedDayIndex > 0
    ? selectComparison(journal, recordedDays[selectedDayIndex - 1], albumDay) : null
  const nextDay = nextDueDay(invitation, day)
  const dynamicNextDay = nextDay !== null && !DAYS.includes(nextDay as typeof DAYS[number]) &&
    (cadence !== 'daily' || invitation.pendingChange !== null)
  const navigationDays = [...new Set<number>([...DAYS.filter((target) => target > day), ...(dynamicNextDay ? [nextDay] : [])])]
    .sort((first, second) => first - second)
  const answeredQuestions = selectAnsweredQuestions(journal, albumDay)
    .filter((item) => !journal.entries.find((entry) => entry.id === item.answerEntryId)?.topicId.startsWith('proactive-day-'))
  const todayQuestions = selectAnsweredQuestions(journal, day)
  const entryById = new Map(journal.entries.map((entry) => [entry.id, entry]))
  const controlsById = new Map(controlExchanges.map((exchange) => [exchange.id, exchange]))
  const todayTimeline: TimelineItem[] = session.projectMessages(snapshot)
    .filter((message) => session.dayForTimestamp(message.occurredAt) === day)
    .flatMap((message): TimelineItem[] => {
      if (message.entryId) {
        const entry = entryById.get(message.entryId)
        return entry ? [{ kind: 'entry' as const, order: message.sequence, entry }] : []
      }
      const exchange = controlsById.get(message.id)
      return exchange ? [{ kind: 'control' as const, order: message.sequence, exchange, text: message.text }] : []
    })

  useLayoutEffect(() => {
    if (activeTab !== 'chat' || !chatScrollRef.current) return
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [activeTab, day, journal.entries.length, controlExchanges.length, questionIndex, extraQuestion])

  function refresh() {
    setSnapshot(session.read())
  }

  function showQuestion(targetDay: number, moment = false) {
    const next = session.displayNextQuestion(targetDay, moment)
    setActiveQuestionId(next.id)
    refresh()
  }

  function logControl(id: string, reply: string, promptQuestionId?: string) {
    setControlExchanges((current) => [...current, { id, reply, promptQuestionId }])
  }

  function finishRound(answered: boolean) {
    const next = settleInvitation(invitation, day, answered)
    const nextCadence = cadenceForDay(next, day)
    setInvitation(next)
    if (nextCadence !== cadence) setChoice(nextCadence)
    setStatus(nextCadence !== cadence
      ? `节奏已调为${nextCadence === 'weekly' ? '每周' : '仅我主动'}，你想聊随时来`
      : answered ? '今天的记录已写入画册。' : '今天先到这里；你想聊随时来。')
  }

  function answerQuestion() {
    if (extraQuestion) {
      setExtraQuestion(false)
      setActiveQuestionId(null)
      setThirdUsed(true)
      setInvitation(shareProactively(invitation))
      setStatus('主动补充已写入今天的画册。')
      return
    }
    if (questionIndex + 1 < questionCount) {
      setQuestionIndex((index) => index + 1)
      setAnsweredInRound(true)
      showQuestion(day)
    } else {
      setActiveQuestionId(null)
      finishRound(true)
    }
  }

  function skipQuestion() {
    if (questionIndex + 1 < questionCount) {
      setQuestionIndex((index) => index + 1)
      showQuestion(day, true)
    } else {
      setActiveQuestionId(null)
      finishRound(answeredInRound)
    }
  }

  function viewRecordedDay(target: number) {
    setViewedDay(target)
    setEditingId(null)
    setEditDraft('')
    setEditingTitle(false)
    setTitleDraft('')
    setPrintPending(false)
    setPendingEntryChange(null)
  }

  function advanceDay(target: number) {
    if (target <= day) return
    viewRecordedDay(target)
    const settled = settleInvitation(invitation, day, answeredInRound)
    const next = isInvitationDue(settled, target) ? markInvitationShown(settled, target) : settled
    setInvitation(next)
    setDay(target)
    setQuestionIndex(0)
    setAnsweredInRound(false)
    setExtraQuestion(false)
    setThirdUsed(false)
    if (isInvitationDue(next, target)) showQuestion(target)
    else setActiveQuestionId(null)
    setStatus(draft.trim() ? `未发送的消息仍在输入框中；发送后会记入第 ${target} 天。` : '')
  }

  function share() {
    setInvitation(shareProactively(invitation))
    setAnsweredInRound(true)
    setStatus('这句话已写入今天的画册；邀请节奏从这里重新计算。')
  }

  function sendMessage() {
    const text = draft.trim()
    if (!text) return
    const intent = classifyChatIntent(text)
    const promptId = due || extraQuestion ? activeQuestionId : null
    let result: ReturnType<typeof session.sendMessage>
    try {
      result = session.sendMessage(day, text, promptId)
    } catch {
      setStatus('这句话暂时没有保存，请重试。')
      return
    }
    setDraft('')
    refresh()
    if (result.entry) setViewedDay(day)
    if (intent === 'skip' || intent === 'decline') {
      if (extraQuestion) {
        setExtraQuestion(false)
        setActiveQuestionId(null)
        setThirdUsed(true)
        setStatus('主动加问已收起；今天的邀请结算不变。')
        logControl(result.message.id, '好，这道加问就停在这里。想记什么仍可以直接说。', promptId ?? undefined)
      } else if (due) {
        const firstSkip = intent === 'skip' && questionIndex + 1 < questionCount
        if (intent === 'skip') skipQuestion()
        else { setActiveQuestionId(null); finishRound(answeredInRound) }
        logControl(result.message.id, firstSkip ? '好，换一个轻一点的问题。' : '好，今天先到这里。你想说时随时来。', promptId ?? undefined)
      } else {
        logControl(result.message.id, '今天没有待答的问题；想记什么可以直接告诉我。')
      }
      return
    }
    if (intent === 'more') {
      const canAskThird = roundClosed && invitation.shownDays.includes(day) && cadence === 'daily' &&
        !thirdUsed && !invitation.paused
      if (canAskThird) {
        setExtraQuestion(true)
        showQuestion(day)
        logControl(result.message.id, '好，再聊一件事。')
      } else {
        logControl(result.message.id, due || extraQuestion ? '现在还有一个问题在这里；你可以直接继续说。' :
          '今天没有新的加问；想记什么可以直接告诉我。')
      }
      return
    }
    if (intent === 'share' || (!due && !extraQuestion)) share()
    else answerQuestion()
  }

  function applyEntryChange(change: EntryChange) {
    const affectedTitleDays = titleDaysAffectedByEntryChange(journal, change.id, change.kind)
    if (affectedTitleDays.length !== change.affectedTitleDays.length ||
      affectedTitleDays.some((target, index) => target !== change.affectedTitleDays[index])) {
      showTitleConfirmation({ ...change, affectedTitleDays, preflightUpdated: true })
      return
    }
    if (!journal.entries.some((entry) => entry.id === change.id)) {
      if (pendingEntryChange) titleConfirmFocusReturnRef.current = 'status'
      setPendingEntryChange(null)
      setStatus('这条原话已不存在，请重新选择。')
      return
    }
    try {
      if (change.kind === 'editEntry') session.editEntry(change.id, change.text)
      else session.deleteEntry(change.id)
      const currentQuestion = session.read().questions.find((question) => question.id === activeQuestionId)
      if ((due || extraQuestion) && currentQuestion && currentQuestion.status !== 'ready') {
        showQuestion(day)
      } else refresh()
    } catch {
      setPendingEntryChange(null)
      setStatus('记录已变化，请重新选择后再试。')
      return
    }
    if (pendingEntryChange) titleConfirmFocusReturnRef.current = 'status'
    setPendingEntryChange(null)
    setEditingId(null)
    setEditDraft('')
    if (change.kind === 'deleteEntry' || affectedTitleDays.includes(albumDay)) {
      setEditingTitle(false)
      setTitleDraft('')
    }
    const result = change.kind === 'editEntry'
      ? '原话已修订；未回答的问题和对照已按当前记录更新。'
      : '这条记录已删除；相关引用已撤下。'
    const titleResult = affectedTitleDays.length > 0
      ? ` ${affectedTitleDays.length} 个日页标题及其修订历史已撤下，可以重新设置。` : ''
    setStatus(result + titleResult)
  }

  function saveEdit() {
    if (!editingId || !editDraft.trim()) return
    const text = editDraft.trim()
    if (journal.entries.find((entry) => entry.id === editingId)?.text === text) {
      setEditingId(null)
      setEditDraft('')
      return
    }
    const change: EntryChange = {
      kind: 'editEntry', id: editingId, text,
      affectedTitleDays: titleDaysAffectedByEntryChange(journal, editingId, 'editEntry'),
    }
    if (change.affectedTitleDays.length > 0) showTitleConfirmation(change)
    else applyEntryChange(change)
  }

  function saveTitle() {
    if (!titleDraft.trim()) return
    if (album?.title === titleDraft.trim()) {
      setEditingTitle(false)
      setTitleDraft('')
      return
    }
    try {
      session.setDayTitle(albumDay, titleDraft.trim())
      refresh()
    } catch {
      setStatus('标题没有保存，请重试。')
      return
    }
    setEditingTitle(false)
    setTitleDraft('')
    setStatus('日页标题已修订。')
  }

  function deleteEntry(id: string) {
    const change: EntryChange = {
      kind: 'deleteEntry', id,
      affectedTitleDays: titleDaysAffectedByEntryChange(journal, id, 'deleteEntry'),
    }
    if (change.affectedTitleDays.length > 0) showTitleConfirmation(change)
    else applyEntryChange(change)
  }

  function applyCadence() {
    setInvitation(changeCadence(invitation, choice, day))
    setStatus(`新节奏从第 ${day + 1} 天生效`)
  }

  function togglePause() {
    if (invitation.paused) {
      const next = resumeInvitations(invitation, day)
      setInvitation(next)
      setStatus(nextDueDay(next, day) === null ? '邀请已恢复；目前只在你主动分享时记录。' :
        `邀请已恢复；下次邀请在第 ${nextDueDay(next, day)} 天。`)
    } else {
      setInvitation(pauseInvitations(invitation))
      setExtraQuestion(false)
      setStatus('邀请已暂停；暂停期间不会补发。')
    }
  }

  function toggleConsent(source: BehaviorSource) {
    setConsents((current) => ({ ...current, [source]: !current[source] }))
  }

  return (
    <main className={'product-shell product-tab-' + activeTab} aria-label="心灵画册产品">
      <nav className="product-nav screen-only" aria-label="产品导航">
        <div className="product-brand"><span className="product-brand-mark" aria-hidden="true">●</span>
          <strong>心灵画册</strong><small>把日子慢慢装订起来</small></div>
        <div className="product-nav-links">
          <button type="button" aria-current={activeTab === 'chat' ? 'page' : undefined} onClick={() => setActiveTab('chat')}>对话</button>
          <button type="button" aria-current={activeTab === 'album' ? 'page' : undefined} onClick={() => setActiveTab('album')}>画册</button>
          <button type="button" aria-current={activeTab === 'data' ? 'page' : undefined} onClick={() => setActiveTab('data')}>生活数据</button>
        </div>
        <p className="product-nav-footnote">只保留在本次页面<br />刷新后内容会清空</p>
      </nav>
      <div className="product-workspace">
        <header className="product-header screen-only">
          <div><p className="product-overline">心灵画册 / {activeTab === 'chat' ? '日常对话' : activeTab === 'album' ? '我的画册' : '生活数据'}</p>
            {activeTab !== 'data' && <h1>{activeTab === 'chat' ? '聊聊今天' : '翻开画册'}</h1>}</div>
          <div className="product-header-meta">
            <span>第 {day} 天 · 演示日期 {session.dateForDay(day)} · {cadenceLabel[cadence]}{invitation.paused && ' · 已暂停'}</span>
            <span>规则模式 · 仅本次页面</span>
            <button type="button" onClick={onReset} aria-label="清除本次内容">清除</button>
          </div>
        </header>
        {status && <p ref={statusRef} className="free-status product-status screen-only" role="status" tabIndex={-1}>{status}</p>}
        <div className="product-content">
          <section className="product-chat screen-only" aria-label="对话记录" hidden={activeTab !== 'chat'}>
            <div className="product-chat-scroll" ref={chatScrollRef}>
              <p className="product-day-divider"><span>第 {day} 天</span></p>
              <div className="product-thread">
                {todayTimeline.map((item) => {
                  if (item.kind === 'control') return <div className="product-exchange" key={item.exchange.id}>
                    {item.exchange.promptQuestionId && <div className="product-bubble-row agent">
                      <span className="product-avatar" aria-hidden="true">画</span>
                      <div className="product-bubble"><small>心灵画册 · 当时的问题</small>
                        <p>{snapshot.questions.find((question) => question.id === item.exchange.promptQuestionId)?.text ?? '旧提问已撤下。'}</p></div>
                    </div>}
                    <div className="product-bubble-row user"><div className="product-bubble"><p>{item.text}</p></div></div>
                    <div className="product-bubble-row agent"><span className="product-avatar" aria-hidden="true">画</span>
                      <div className="product-bubble"><p>{item.exchange.reply}</p></div></div>
                  </div>
                  const entry = item.entry
                  const answered = todayQuestions.find((questionRecord) => questionRecord.answerEntryId === entry.id)
                  const isProactive = entry.topicId.startsWith('proactive-day-')
                  return <div className="product-exchange" key={entry.id}>
                    {answered && !isProactive && <div className="product-bubble-row agent">
                      <span className="product-avatar" aria-hidden="true">画</span>
                      <div className="product-bubble"><small>心灵画册 · 当时的问题</small>
                        <p>{answered.status === 'ready' ? answered.text :
                          answered.status === 'reference-deleted' ? '这题引用的原话已删除。' : '这题引用的原话已有修订。'}</p></div>
                    </div>}
                    <div className="product-bubble-row user"><div className="product-bubble">
                      <p>{entry.text}</p>
                      <time dateTime={entry.recordedAt}>{entry.recordedAt.slice(11, 16)}{entry.revision > 1 && ' · 已修订'}</time>
                    </div></div>
                  </div>
                })}
                {(due || extraQuestion) && <div className="product-bubble-row agent current">
                  <span className="product-avatar" aria-hidden="true">画</span>
                  <div className="product-bubble"><small>第 {day} 天 · {extraQuestion ? '主动第 3 题' : '第 ' + (questionIndex + 1) + ' 题'}</small>
                    <p>{visibleQuestionText}</p></div>
                </div>}
                {!due && !extraQuestion && <div className="product-rest" role="note">
                  <strong>{roundClosed ? '今天的邀请已结束' : '第 ' + day + ' 天不邀请'}</strong>
                  <p>{roundClosed ? '今天可以停在这里，也可以自己再记一句。' :
                    '未展示的日期不会补发问题；想记事时仍可直接留言。'}</p>
                  {!roundClosed && cadence === 'weekly' && nextDay !== null && <p className="product-next-hint">下次邀请在第 {nextDay} 天</p>}
                </div>}
              </div>
            </div>
            <div className="product-chat-controls">
              <div className="product-composer">
                <div className="product-composer-input">
                  <label htmlFor="free-message">发送消息</label>
                  <textarea id="free-message" value={draft} maxLength={10000} onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault(); sendMessage()
                      }
                    }} rows={2} placeholder="想说什么，直接写在这里…" />
                  <button type="button" className="product-send" onClick={sendMessage} disabled={!draft.trim()}>发送</button>
                </div>
                <p className="product-composer-note">演示版会将一般消息记入画册；可随时修改或删除。</p>
              </div>
              <details className="product-settings"><summary>邀请节奏与演示日期</summary>
                <p>连续两次实际展示的整轮都没有回答，只会降低邀请频率。历史回看不计入。</p>
                <div className="product-settings-actions">
                  <label htmlFor="free-cadence">手动调整节奏</label>
                  <select id="free-cadence" value={choice} onChange={(event) => setChoice(event.target.value as Cadence)}>
                    <option value="daily">每日两问</option><option value="weekly">每周一问</option><option value="manual">仅我主动</option>
                  </select>
                  <button type="button" onClick={applyCadence}>应用节奏</button>
                  <button type="button" onClick={togglePause}>{invitation.paused ? '恢复邀请' : '暂停邀请'}</button>
                </div>
                <div className="product-advance"><span>显式推进演示日</span>
                  {navigationDays.map((target) => <button type="button" key={target}
                    onClick={() => advanceDay(target)}>推进到第 {target} 天</button>)}
                </div>
                {dynamicNextDay && <p>下次邀请在第 {nextDay} 天；中间日期不会补发。</p>}
              </details>
            </div>
          </section>

          <section className="product-album" aria-label="过往记录" hidden={activeTab !== 'album'}>
            <div className="product-album-intro screen-only">
              <div><p className="product-overline">一本只属于本次页面的画册</p>
                <h2>这些天，你留下了什么</h2><p>日页来自你的原话。翻阅过去不会触发新的提问。</p></div>
              {album && <button type="button" className="guided-print" onClick={openPrintReminder}>打印当前页 ↗</button>}
            </div>
            {recordedDays.length > 0 && <nav className="free-day-nav product-album-days screen-only" aria-label="有记录日期">
              {recordedDays.map((target) => <button type="button" key={target}
                aria-label={'查看第 ' + target + ' 天'} aria-current={albumDay === target ? 'date' : undefined}
                onClick={() => viewRecordedDay(target)}>第 {target} 天<small>{selectAlbum(journal, target)?.entries.length} 条原话</small></button>)}
            </nav>}
            {album ? <>
              <div className="product-album-page"><AlbumPage mode="private" key={albumDay} album={album}
                journal={journal} dateForDay={(target) => '第 ' + target + ' 天'} /></div>
              <section className="free-record-tools product-record-tools screen-only" aria-label="记录管理">
                <h2>管理这一天</h2>
                <div className="free-title-tools">
                  {editingTitle ? <div className="free-edit-form">
                    <label htmlFor="free-title-edit">日页标题</label>
                    <input id="free-title-edit" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} />
                    <button type="button" onClick={saveTitle} disabled={!titleDraft.trim()}>保存标题</button>
                    <button type="button" onClick={() => { setEditingTitle(false); setTitleDraft('') }}>取消修改标题</button>
                  </div> : <button type="button" onClick={() => {
                    setEditingTitle(true); setTitleDraft(album.titleRevision > 0 ? album.title : '')
                  }}>修改日页标题</button>}
                </div>
                {album.entries.map((entry) => <div className="free-record-row" key={entry.id}>
                  <p>“{entry.text}”</p>
                  {editingId === entry.id ? <div className="free-edit-form">
                    <label htmlFor={'edit-' + entry.id}>修改原话</label>
                    <textarea id={'edit-' + entry.id} value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={3} />
                    <button type="button" onClick={saveEdit} disabled={!editDraft.trim()}>保存修改</button>
                    <button type="button" onClick={() => { setEditingId(null); setEditDraft('') }}>取消修改</button>
                  </div> : <div className="free-record-actions">
                    <button type="button" onClick={() => { setEditingId(entry.id); setEditDraft(entry.text) }}>修改这条原话</button>
                    <button type="button" onClick={() => deleteEntry(entry.id)}>删除这条原话</button>
                  </div>}
                </div>)}
              </section>
            </> : <div className="product-album-empty screen-only" role="status">
              <span aria-hidden="true">○</span><h2>画册还没有第一页</h2>
              <p>回到对话，回答一个问题或主动留下一句，这里就会出现你的日页。</p>
              <button type="button" onClick={() => setActiveTab('chat')}>去对话</button>
            </div>}
            {album && <section className="free-comparison guided-comparison product-comparison screen-only"
              role="region" aria-label="两日对照">
              <div className="guided-comparison-heading"><span className="guided-section-index">与过去相比</span>
                <h2>两日对照</h2><p>同一主题只并列原话；规则模式不判断变化原因。</p></div>
              {comparison ? <div className="guided-comparison-pages">
                {comparison.entries.map((entry) => <div key={entry.id}>
                  <span>第 {entry.day} 天</span><blockquote>“{entry.text}”</blockquote><small>来源：{entry.source}</small>
                </div>)}
              </div> : <p className="free-insufficient">资料不足，暂时无法对照两天原话。</p>}
            </section>}
            {album && <section className="free-question-history product-question-history screen-only"
              role="region" aria-label="已回答问题">
              <h2>本日已回答问题</h2>
              {answeredQuestions.length > 0 ? <ol>{answeredQuestions.map((item, index) => <li key={albumDay + '-' + index}>
                <span>第 {albumDay} 天 · {item.status === 'reference-revised' ? '引用已有修订' :
                  item.status === 'reference-deleted' ? '引用已删除' : '规则问题'}</span>
                <p>{item.status === 'ready' ? item.text :
                  item.status === 'reference-deleted' ? '这题引用的原话已删除。' : '这题引用的原话已有修订。'}</p>
              </li>)}</ol> : <p>这一天没有已回答的问题。</p>}
            </section>}
          </section>

          <section className="product-data screen-only" aria-label="生活数据" hidden={activeTab !== 'data'}>
            <DataInsights consents={consents} onToggle={toggleConsent} />
          </section>
        </div>
        <footer className="product-footer screen-only">
          <p>这是可操作的前端演示：规则提问与模拟数据不会读取真实设备，也没有账号或长期保存。</p>
        </footer>
      </div>
      {printPending && <dialog ref={printDialogRef} className="free-print-dialog screen-only" role="dialog"
        aria-modal="true" aria-labelledby="free-print-title"
        onCancel={(event) => { event.preventDefault(); closePrintReminder() }}>
        <p className="guided-section-index">打印前提醒</p><h2 id="free-print-title">打印前提醒</h2>
        <p>打印或另存的 PDF 将离开本次页面内存保护，导出的文件无法由这里删除，请自行妥善保管。</p>
        <div className="free-print-actions">
          <button type="button" autoFocus onClick={closePrintReminder}>取消打印</button>
          <button type="button" onClick={() => { closePrintReminder(); window.print() }}>继续打印</button>
        </div>
      </dialog>}
      {pendingEntryChange && <dialog ref={titleConfirmRef} className="free-print-dialog free-title-dialog screen-only"
        role="dialog" aria-modal="true" aria-labelledby="free-title-confirm-title"
        onCancel={(event) => { event.preventDefault(); closeTitleConfirmation() }}>
        <p className="guided-section-index">记录修改确认</p><h2 id="free-title-confirm-title">确认撤下日页标题</h2>
        {pendingEntryChange.preflightUpdated && <p>关联标题已变化，请按更新后的清单重新确认。</p>}
        {pendingEntryChange.affectedTitleDays.length > 0 ?
          <p>{pendingEntryChange.kind === 'editEntry' ? '修改' : '删除'}这条原话会撤下
            {' '}{pendingEntryChange.affectedTitleDays.length} 个日页标题及其修订历史
            （{pendingEntryChange.affectedTitleDays.map((target) => '第 ' + target + ' 天').join('、')}）。
            标题可能引用已有原话，因此无法安全保留；继续后可以重新设置。</p> :
          <p>现在没有日页标题会被撤下。请再次确认是否继续{pendingEntryChange.kind === 'editEntry' ? '修改' : '删除'}这条原话。</p>}
        <div className="free-print-actions">
          <button type="button" autoFocus onClick={closeTitleConfirmation}>
            取消{pendingEntryChange.kind === 'editEntry' ? '修改' : '删除'}</button>
          <button type="button" onClick={() => applyEntryChange(pendingEntryChange)}>
            继续{pendingEntryChange.kind === 'editEntry' ? '修改' : '删除'}</button>
        </div>
      </dialog>}
    </main>
  )
}

export default function FreeTrial() {
  const [session, setSession] = useState(0)
  return <FreeSession key={session} onReset={() => setSession((value) => value + 1)} />
}
