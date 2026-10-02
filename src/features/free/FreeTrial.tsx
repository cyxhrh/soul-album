import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  cadenceForDay, changeCadence, createInvitationState, isInvitationDue,
  markInvitationShown, pauseInvitations, resumeInvitations, settleInvitation,
  shareProactively, type Cadence, type InvitationState,
} from '../../domain/invitations'
import { titleDaysAffectedByEntryChange, type Entry } from '../../domain/journal'
import { createBrowserLocalSession } from '../../domain/browserLocalSession'
import { classifyChatIntent } from '../../domain/chatIntent'
import { selectAlbum, selectAnsweredQuestions, type AlbumView } from '../../domain/selectors'
import {
  currentChatTurns, privateChatAvailableOnThisHost, PrivateChatRequestError, requestPrivateChat,
  sourceForMessage, sourceIsCurrent, validChatRequest,
  type PrivateChatRequest, type PrivateChatSource, type PrivateChatTurn,
} from './privateChat'
import { ChatAvatar, COMPANIONS, companionImage, MicrophoneIcon, ProductIcon } from './ChatIdentity'
import { chatOpenings, openingForHour } from '../../../shared/chatOpening'
import AlbumPage from '../album/AlbumPage'
import DailyAlbum from '../album/DailyAlbum'
import { createDailyRecord, type DailyRecord } from '../album/dailyRecord'
import { collectDailySources, syncDailyRecord } from '../album/dailyArchive'
import type { DailyMessage } from '../../../shared/dailyAlbum'
import { loadFreeSession } from './freeSessionCache'
import { clearSavedSession, saveSession, SESSION_STORAGE_KEY } from './sessionPersistence'
import DataInsights, { type BehaviorConsents, type BehaviorSource } from '../data/DataInsights'
import '../../styles/product.css'
import '../../styles/messenger.css'

const DAYS = [1, 2, 8, 9] as const
const REPLY_DELAY_MS = 2400
const MAX_RECORDING_MS = 30_000
const BOOK_TURN_FALLBACK_MS = 850
type EntryChange =
  | { kind: 'editEntry'; id: string; text: string; affectedTitleDays: number[]; preflightUpdated?: boolean }
  | { kind: 'deleteEntry'; id: string; affectedTitleDays: number[]; preflightUpdated?: boolean }
type ProductTab = 'chat' | 'album' | 'data'
type ModelConnection = { state: 'checking' | 'ready' | 'offline'; modelName: string | null }
type BookTurn = { direction: 'next' | 'previous'; fromDay: number; toDay: number }
type ControlExchange = { id: string; reply: string; promptQuestionId?: string }
type TimelineItem = { kind: 'entry'; order: number; messageId: string; sentAt: string; entry: Entry } |
  { kind: 'control'; order: number; messageId: string; sentAt: string; exchange?: ControlExchange; text: string }

function chatLocalDateTime(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const field = (kind: string) => parts.find((part) => part.type === kind)?.value ?? ''
  const year = Number(field('year'))
  const month = Number(field('month'))
  const date = Number(field('day'))
  const weekday = '日一二三四五六'[new Date(Date.UTC(year, month - 1, date)).getUTCDay()]
  const clock = `${field('hour')}:${field('minute')}`
  return { date: `${year}-${field('month')}-${field('day')}`,
    clock, detailed: `${year}年${month}月${date}日 星期${weekday} ${clock}` }
}

function chatTimeMarker(previous: TimelineItem | undefined, current: TimelineItem, timezone: string): string | null {
  if (!previous) return null
  const local = chatLocalDateTime(current.sentAt, timezone)
  if (chatLocalDateTime(previous.sentAt, timezone).date !== local.date) return local.detailed
  return new Date(current.sentAt).getTime() - new Date(previous.sentAt).getTime() >= 15 * 60_000
    ? local.clock : null
}

function chatFailureCopy(error: unknown): string {
  const prefix = '你写下的话仍保存在本页，没有自动重试。'
  if (!(error instanceof PrivateChatRequestError)) return `本机千问服务暂时无法连接。${prefix}`
  switch (error.code) {
    case 'invalid_model_output': return `千问已返回，但这次回复未通过格式与引用检查，不能作为可信回应显示。${prefix}`
    case 'rate_limited': return `千问调用次数或频率已达到本机限制，请稍后再试。${prefix}`
    case 'model_timeout': return `等待千问回复超时。${prefix}`
    case 'model_unavailable': return `千问服务暂时不可用。${prefix}`
    case 'model_not_configured': return `本机千问聊天尚未启用，请先启动模型服务。${prefix}`
    case 'invalid_request': return `本机服务未接受这次发送内容。${prefix}`
    case 'no_reliable_citation': return `这次回复没有可靠的原话依据。${prefix}`
    default: return `本机千问服务暂时无法连接。${prefix}`
  }
}

async function readModelConnection(signal: AbortSignal): Promise<ModelConnection> {
  if (!privateChatAvailableOnThisHost(window.location.hostname)) {
    return { state: 'offline', modelName: null }
  }
  const response = await fetch('/api/ai/model-status', {
    signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
  })
  if (!response.ok) return { state: 'offline', modelName: null }
  const raw = await response.text()
  if (raw.length > 1024) return { state: 'offline', modelName: null }
  const result: unknown = JSON.parse(raw)
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { state: 'offline', modelName: null }
  }
  const value = result as Record<string, unknown>
  const model = value.model && typeof value.model === 'object' && !Array.isArray(value.model)
    ? value.model as Record<string, unknown> : null
  const modelName = model?.provider === 'qwen' && typeof model.id === 'string' &&
    /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(model.id) ? model.id : null
  return { state: value.status === 'ready' && modelName ? 'ready' : 'offline', modelName }
}

function nextDueDay(state: InvitationState, afterDay: number): number | null {
  for (let future = afterDay + 1; future <= afterDay + 28; future++) {
    if (isInvitationDue(state, future)) return future
  }
  return null
}

function AlbumPreviewPage({ album, openingDay, dateForDay, onOpen }: {
  album: AlbumView | null
  openingDay: number
  dateForDay: (day: number) => string
  onOpen?: (day: number) => void
}) {
  const shortDate = (day: number) => dateForDay(day).slice(5).replace('-', '.')
  if (!album) return <div className="album-bookplate">
    <p className="album-bookplate-eyebrow">写给今天的你</p>
    <span className="album-bookplate-mark" aria-hidden="true" />
    <h3>谢谢你，愿意为今天停一停</h3>
    <p>不必把一切都说清楚。愿意留下一句话，就已经是在认真照顾自己。</p>
    <small>这是我们一起装订的第一页 <span>{shortDate(openingDay)}</span></small>
  </div>

  const firstEntry = album.entries[0]
  const excerpt = firstEntry && Array.from(firstEntry.text)
  return <>
    <div className="album-preview-folio"><span>上一页</span><span>{shortDate(album.day)}</span></div>
    <p className="album-preview-date" aria-hidden="true">{shortDate(album.day)}</p>
    <p className="album-preview-kicker">第 {album.day} 天 · {album.entries.length} 条原话</p>
    <h3>{album.titleRevision > 0 ? album.title : firstEntry ? '那天留下的原话' : '那天补充的准确背景'}</h3>
    {firstEntry ? <blockquote>“{excerpt?.slice(0, 80).join('')}{excerpt && excerpt.length > 80 ? '…' : ''}”</blockquote>
      : <p className="album-preview-empty">这一天只有你补充的纠正记录。</p>}
    {onOpen && <button type="button" onClick={() => onOpen(album.day)}>查看这一天详情 <span>↗</span></button>}
  </>
}

function initializeSession() {
  const loaded = loadFreeSession()
  const openingId = loaded.saved?.openingId ?? openingForHour(new Date().getHours())
  try {
    return { ...loaded, openingId, session: createBrowserLocalSession({ openingId, restore: loaded.saved?.session }) }
  } catch {
    return { saved: null, error: '本机记录暂时无法恢复，原缓存未覆盖。可先下载备份，再清除本机记录。', openingId,
      session: createBrowserLocalSession({ openingId }) }
  }
}

function exampleRecord() {
  const record = createDailyRecord('2026-09-30', [
    { id: 'sample-user-1', role: 'user', text: '下午把做了一半的小项目讲给朋友听。原本有点紧张，讲着讲着反而把思路理清了。', recordedAt: '2026-09-30T08:20:00Z' },
    { id: 'sample-assistant-1', role: 'assistant', text: '把想法说出来，也让你自己看得更清楚了。最想接着做的是哪一部分？', recordedAt: '2026-09-30T08:20:02Z' },
    { id: 'sample-user-2', role: 'user', text: '先把首页做好吧。回来的路上买了一束花，今天就先到这里。', recordedAt: '2026-09-30T08:22:00Z' },
  ])
  return { ...record, title: '说出来，思路就清楚了', diary: '下午，把做了一半的小项目讲给朋友听。开始时有些紧张，讲着讲着，自己的思路也清楚了。\n\n接下来想先把首页做好。回来的路上买了一束花，今天就先到这里。',
    portrait: { facts: ['向朋友介绍了进行中的项目。', '打算先完善首页，回程买了一束花。'], feelings: ['开始有些紧张，讲述时思路逐渐清晰。'],
      observations: [{ text: '这一次，向朋友讲述帮助了思路整理。是否适用于其他事情，还不确定。', evidenceIds: ['sample-user-1'] }], uncertainties: ['一次经历不足以判断长期偏好或性格。'] } }
}

function FreeSession({ onReset }: { onReset: () => void }) {
  const [initial] = useState(initializeSession)
  const restored = initial.saved
  const [openingId] = useState(initial.openingId)
  const opening = chatOpenings[openingId]
  const [openingDismissed, setOpeningDismissed] = useState(restored?.openingDismissed ?? false)
  const [session] = useState(initial.session)
  const [snapshot, setSnapshot] = useState(() => session.read())
  const journal = session.projectJournal(snapshot)
  const [activeTab, setActiveTab] = useState<ProductTab>('chat')
  const [modelConnection, setModelConnection] = useState<ModelConnection>(() => ({
    state: privateChatAvailableOnThisHost(window.location.hostname) ? 'checking' : 'offline',
    modelName: null,
  }))
  const [chatTurns, setChatTurns] = useState<PrivateChatTurn[]>(restored?.chatTurns ?? [])
  const [chatRequestPending, setChatRequestPending] = useState(false)
  const [chatError, setChatError] = useState('')
  const [controlExchanges, setControlExchanges] = useState<ControlExchange[]>(restored?.controlExchanges ?? [])
  const [consents, setConsents] = useState<BehaviorConsents>({ steps: false, spending: false, screenTime: false })
  const [invitation, setInvitation] = useState(() => restored?.invitation ?? markInvitationShown(createInvitationState(), 1))
  const [day, setDay] = useState(restored?.day ?? 1)
  const [viewedDay, setViewedDay] = useState(restored?.viewedDay ?? 1)
  const [bookTurn, setBookTurn] = useState<BookTurn | null>(null)
  const [questionIndex, setQuestionIndex] = useState(restored?.questionIndex ?? 0)
  const [answeredInRound, setAnsweredInRound] = useState(restored?.answeredInRound ?? false)
  const [extraQuestion, setExtraQuestion] = useState(restored?.extraQuestion ?? false)
  const [thirdUsed, setThirdUsed] = useState(restored?.thirdUsed ?? false)
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(restored ? restored.activeQuestionId : session.firstQuestionId)
  const [draft, setDraft] = useState(restored?.draft ?? '')
  const [companionId, setCompanionId] = useState<string>('manman')
  const companion = COMPANIONS.find((item) => item.id === companionId) ?? COMPANIONS[2]
  const companionSrc = companionImage(companion.id)
  const [voiceConversation, setVoiceConversation] = useState(false)
  const [voiceDelivery, setVoiceDelivery] = useState<{ text: string; shown: number } | null>(null)
  const [lastVoiceText, setLastVoiceText] = useState('')
  const [callMessageId, setCallMessageId] = useState<string | null>(null)
  const [callSeconds, setCallSeconds] = useState(0)
  const [dailyRecords, setDailyRecords] = useState<Record<string, DailyRecord>>(restored?.dailyRecords ?? {})
  const [dailySources, setDailySources] = useState<Record<string, DailyMessage[]>>(restored?.dailySources ?? {})
  const [sample, setSample] = useState(exampleRecord)
  const [storageError, setStorageError] = useState(initial.error ?? '')
  const [albumEditing, setAlbumEditing] = useState(false)
  const [voiceState, setVoiceState] = useState<'idle' | 'requesting' | 'recording' | 'transcribing' | 'failure'>('idle')
  const [voiceMessage, setVoiceMessage] = useState('')
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [choice, setChoice] = useState<Cadence>(restored?.choice ?? 'daily')
  const [status, setStatus] = useState('')
  const [printPending, setPrintPending] = useState(false)
  const [pendingEntryChange, setPendingEntryChange] = useState<EntryChange | null>(null)
  const [correctingQuestion, setCorrectingQuestion] = useState(false)
  const [correctionDraft, setCorrectionDraft] = useState('')
  const [comparisonFirstId, setComparisonFirstId] = useState('')
  const [comparisonSecondId, setComparisonSecondId] = useState('')
  const printDialogRef = useRef<HTMLDialogElement>(null)
  const printOpenerRef = useRef<HTMLElement | null>(null)
  const titleConfirmRef = useRef<HTMLDialogElement>(null)
  const titleConfirmOpenerRef = useRef<HTMLElement | null>(null)
  const titleConfirmFocusReturnRef = useRef<'opener' | 'status' | null>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const chatControllerRef = useRef<AbortController | null>(null)
  const modelStatusControllerRef = useRef<AbortController | null>(null)
  const sendLockRef = useRef(false)
  const sendGenerationRef = useRef(0)
  const detailsDialogRef = useRef<HTMLDialogElement>(null)
  const detailsTriggerRef = useRef<HTMLButtonElement>(null)
  const settingsRef = useRef<HTMLDetailsElement>(null)
  const replyTimerRef = useRef<number | null>(null)
  const bookTurnTimerRef = useRef<number | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const microphoneRef = useRef<MediaStream | null>(null)
  const voiceWorkerRef = useRef<Worker | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const recordingTickerRef = useRef<number | null>(null)
  const voiceFrameRef = useRef<number | null>(null)
  const voiceAudioContextRef = useRef<AudioContext | null>(null)
  const voiceSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const voiceCanvasRef = useRef<HTMLCanvasElement>(null)
  const voiceButtonRef = useRef<HTMLButtonElement>(null)
  const voiceRetryRef = useRef<HTMLButtonElement>(null)
  const messageInputRef = useRef<HTMLTextAreaElement>(null)
  const voiceEntryRef = useRef<HTMLButtonElement>(null)
  const companionPickerRef = useRef<HTMLDetailsElement>(null)
  const voiceConversationRef = useRef(false)
  const voiceGenerationRef = useRef(0)
  const voiceSubmitRef = useRef<(text: string) => void>(() => {})
  const activeTabRef = useRef(activeTab)
  const recordedAudioRef = useRef<Blob | null>(null)
  const focusDraftAfterVoiceRef = useRef(false)
  const voiceDisposedRef = useRef(false)

  useEffect(() => {
    if (!voiceConversation) return
    const startedAt = Date.now()
    const timer = window.setInterval(() => setCallSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [voiceConversation])

  useLayoutEffect(() => {
    if (voiceConversation) voiceButtonRef.current?.focus()
  }, [voiceConversation])

  useLayoutEffect(() => {
    voiceSubmitRef.current = (text) => { void sendMessage(text) }
  })

  useEffect(() => {
    if (!voiceDelivery || !voiceConversation) return
    const characters = Array.from(voiceDelivery.text)
    const complete = voiceDelivery.shown >= characters.length
    const timer = window.setTimeout(() => {
      if (complete) {
        setLastVoiceText(voiceDelivery.text)
        setVoiceDelivery(null)
        setVoiceState('idle')
        setVoiceMessage('')
        voiceSubmitRef.current(voiceDelivery.text)
      } else {
        setVoiceDelivery({ ...voiceDelivery, shown: voiceDelivery.shown + 1 })
      }
    }, complete ? 600 : 45)
    return () => window.clearTimeout(timer)
  }, [voiceDelivery, voiceConversation])

  function openVoiceConversation() {
    if (voiceState !== 'idle' || chatRequestPending || typingMessageId || sendLockRef.current) return
    voiceConversationRef.current = true
    setVoiceConversation(true)
    setVoiceDelivery(null)
    setLastVoiceText('')
    setCallMessageId(null)
    setCallSeconds(0)
    setVoiceMessage('')
    if (settingsRef.current) settingsRef.current.open = false
    if (companionPickerRef.current) companionPickerRef.current.open = false
  }

  function closeVoiceConversation(returnFocus = true) {
    voiceGenerationRef.current++
    voiceConversationRef.current = false
    const recorder = recorderRef.current
    if (recorder) {
      recorder.onstop = null
      recorder.onerror = null
      if (recorder.state === 'recording') recorder.stop()
    }
    releaseMicrophone()
    voiceWorkerRef.current?.terminate()
    voiceWorkerRef.current = null
    recordedAudioRef.current = null
    setVoiceDelivery(null)
    setVoiceState('idle')
    setVoiceMessage('')
    setVoiceConversation(false)
    setLastVoiceText('')
    setCallMessageId(null)
    if (returnFocus) window.requestAnimationFrame(() => voiceEntryRef.current?.focus())
  }

  const sourceByDate = useMemo(() => {
    return collectDailySources(snapshot, chatTurns, openingId, session.firstQuestionId, controlExchanges)
  }, [snapshot, chatTurns, openingId, session, controlExchanges])

  useEffect(() => {
    setDailyRecords((current) => {
      const next = Object.fromEntries(Object.entries(sourceByDate).map(([date, messages]) =>
        [date, syncDailyRecord(current[date], dailySources[date], messages, date)]))
      return Object.keys(current).length === Object.keys(next).length &&
        Object.keys(next).every((date) => current[date] === next[date]) ? current : next
    })
    setDailySources(sourceByDate)
  }, [sourceByDate])

  useEffect(() => {
    if (initial.error) return
    try {
      saveSession({ session: session.exportState(), openingId, openingDismissed,
        chatTurns: currentChatTurns(snapshot, chatTurns), controlExchanges, invitation, day, viewedDay,
        questionIndex, answeredInRound, extraQuestion, thirdUsed, activeQuestionId, draft, choice,
        dailyRecords, dailySources })
      setStorageError('')
    } catch (error) { setStorageError(error instanceof Error ? error.message : '本机保存失败，请先下载记录。') }
  }, [snapshot, session, openingId, openingDismissed, chatTurns, controlExchanges, invitation, day,
    viewedDay, questionIndex, answeredInRound, extraQuestion, thirdUsed, activeQuestionId, draft,
    choice, dailyRecords, dailySources, initial.error])

  function saveDailyRecord(record: DailyRecord) {
    setDailyRecords((current) => ({ ...current, [record.date]: record }))
  }

  function downloadCacheBackup() {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY)
      if (!raw) throw new Error('当前没有可读取的本机缓存，请从画册背面下载本页记录。')
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = '渐知-本机缓存备份.json'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { setStorageError(cause instanceof Error ? cause.message : '无法读取缓存，请下载当前画册。') }
  }

  useEffect(() => () => {
    sendGenerationRef.current += 1
    sendLockRef.current = false
    chatControllerRef.current?.abort()
    modelStatusControllerRef.current?.abort()
    if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current)
    if (bookTurnTimerRef.current !== null) window.clearTimeout(bookTurnTimerRef.current)
  }, [])

  useEffect(() => {
    if (!privateChatAvailableOnThisHost(window.location.hostname)) return
    const controller = new AbortController()
    modelStatusControllerRef.current = controller
    void readModelConnection(controller.signal)
      .then((connection) => { if (!controller.signal.aborted) setModelConnection(connection) })
      .catch(() => {
        if (!controller.signal.aborted) setModelConnection({ state: 'offline', modelName: null })
      })
    return () => {
      controller.abort()
      if (modelStatusControllerRef.current === controller) modelStatusControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    voiceDisposedRef.current = false
    return () => {
      voiceDisposedRef.current = true
      voiceGenerationRef.current++
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.onstop = null
        recorderRef.current.stop()
      }
      releaseMicrophone()
      voiceWorkerRef.current?.terminate()
    }
  }, [])

  useLayoutEffect(() => { activeTabRef.current = activeTab }, [activeTab])

  useLayoutEffect(() => {
    const input = messageInputRef.current
    if (!input || activeTab !== 'chat' || voiceState !== 'idle') return
    const resize = () => {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, 144)}px`
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [draft, activeTab, voiceState])

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const settings = settingsRef.current
      if (settings?.open && event.target instanceof Node && !settings.contains(event.target)) settings.open = false
      const picker = companionPickerRef.current
      if (picker?.open && event.target instanceof Node && !picker.contains(event.target)) picker.open = false
    }
    const escape = (event: KeyboardEvent) => {
      const settings = settingsRef.current
      const picker = companionPickerRef.current
      if (event.key === 'Escape' && picker?.open) {
        picker.open = false
        picker.querySelector('summary')?.focus()
        return
      }
      if (event.key === 'Escape' && settings?.open) {
        settings.open = false
        settings.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [])

  useLayoutEffect(() => {
    if (voiceState === 'failure') voiceRetryRef.current?.focus()
    if (!voiceConversation && voiceState === 'idle' && focusDraftAfterVoiceRef.current) {
      focusDraftAfterVoiceRef.current = false
      messageInputRef.current?.focus()
      const end = messageInputRef.current?.value.length ?? 0
      messageInputRef.current?.setSelectionRange(end, end)
    }
  }, [voiceState, voiceConversation])

  useEffect(() => {
    if (voiceState !== 'recording') return
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelVoiceRecording()
    }
    document.addEventListener('keydown', cancelOnEscape)
    return () => document.removeEventListener('keydown', cancelOnEscape)
  }, [voiceState])

  function startVoiceWave(stream: MediaStream) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    voiceAudioContextRef.current = context
    voiceSourceRef.current = source
    void context.resume().catch(() => {
      // Recording can still work even when a browser suspends visual metering.
    })
    // 波形色取自 design token（canvas 2D 无法直接使用 CSS 变量），兜底值即 --accent 的取值
    const waveColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim() || '#c03d2a'
    const samples = new Float32Array(analyser.fftSize)
    const levels = Array<number>(36).fill(0)
    let smoothed = 0
    let lastSampledAt = 0
    function draw(now: number) {
      if (recorderRef.current?.state !== 'recording') return
      const canvas = voiceCanvasRef.current
      const painter = canvas?.getContext('2d')
      if (canvas && painter) {
        const scale = window.devicePixelRatio || 1
        const width = canvas.clientWidth
        const height = canvas.clientHeight
        if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
          canvas.width = Math.round(width * scale)
          canvas.height = Math.round(height * scale)
        }
        painter.setTransform(scale, 0, 0, scale, 0, 0)
        analyser.getFloatTimeDomainData(samples)
        let squareSum = 0
        for (const sample of samples) squareSum += sample * sample
        const volume = Math.min(1, Math.sqrt(squareSum / samples.length) * 5)
        smoothed += (volume - smoothed) * (volume > smoothed ? 0.42 : 0.14)
        if (now - lastSampledAt >= 42) {
          levels.shift()
          levels.push(smoothed)
          lastSampledAt = now
        }
        painter.clearRect(0, 0, width, height)
        const gap = width / levels.length
        painter.fillStyle = waveColor
        levels.forEach((level, index) => {
          const barHeight = 2 + level * (height - 8)
          painter.globalAlpha = 0.45 + index / (levels.length * 1.8)
          painter.fillRect(index * gap + gap * 0.27, (height - barHeight) / 2,
            Math.max(1.5, gap * 0.45), barHeight)
        })
        painter.globalAlpha = 1
      }
      voiceFrameRef.current = window.requestAnimationFrame(draw)
    }
    voiceFrameRef.current = window.requestAnimationFrame(draw)
  }

  function releaseMicrophone() {
    if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current)
    recordingTimerRef.current = null
    if (recordingTickerRef.current !== null) window.clearInterval(recordingTickerRef.current)
    recordingTickerRef.current = null
    if (voiceFrameRef.current !== null) window.cancelAnimationFrame(voiceFrameRef.current)
    voiceFrameRef.current = null
    voiceSourceRef.current?.disconnect()
    voiceSourceRef.current = null
    if (voiceAudioContextRef.current) void voiceAudioContextRef.current.close()
    voiceAudioContextRef.current = null
    microphoneRef.current?.getTracks().forEach((track) => track.stop())
    microphoneRef.current = null
    recorderRef.current = null
  }

  async function transcribeRecording(blob: Blob) {
    const generation = voiceGenerationRef.current
    const isCurrent = () => !voiceDisposedRef.current && generation === voiceGenerationRef.current
    if (!isCurrent()) return
    if (!blob.size) {
      setVoiceMessage('没有录到声音，请重试。')
      setVoiceState('idle')
      return
    }
    recordedAudioRef.current = blob
    setVoiceState('transcribing')
    setVoiceMessage('我在把你刚才说的话写下来，第一次可能要多等一会儿…')
    let context: AudioContext | null = null
    try {
      context = new AudioContext()
      const decoded = await context.decodeAudioData(await blob.arrayBuffer())
      const frames = Math.ceil(decoded.duration * 16_000)
      const offline = new OfflineAudioContext(1, frames, 16_000)
      const source = offline.createBufferSource()
      source.buffer = decoded
      source.connect(offline.destination)
      source.start()
      const samples = (await offline.startRendering()).getChannelData(0)
      if (!isCurrent()) return
      const meanSquare = samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length
      if (!samples.length || meanSquare < 0.000009) {
        setVoiceMessage('没有录到清晰声音，请重试。')
        recordedAudioRef.current = null
        setVoiceState('idle')
        return
      }
      const worker = voiceWorkerRef.current ?? new Worker(new URL('./voiceWorker.ts', import.meta.url), { type: 'module' })
      voiceWorkerRef.current = worker
      worker.onmessage = (event: MessageEvent<{ type: string; text?: string; message?: string }>) => {
        if (!isCurrent()) return
        if (event.data.type === 'loading') setVoiceMessage('我先准备一下，再把刚才的话写下来…')
        if (event.data.type === 'transcribing') setVoiceMessage('我在把你刚才说的话写下来…')
        if (event.data.type === 'result') {
          const text = event.data.text?.trim() ?? ''
          if (text) {
            if (voiceConversationRef.current) {
              recordedAudioRef.current = null
              setVoiceMessage('这段话会自动发送')
              setVoiceDelivery({ text, shown: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? Array.from(text).length : 0 })
              return
            }
            setDraft((current) => [current.trimEnd(), text].filter(Boolean).join('\n'))
            focusDraftAfterVoiceRef.current = true
            recordedAudioRef.current = null
            setVoiceMessage('已转成文字，可修改后发送。')
            setVoiceState('idle')
          } else {
            setVoiceMessage('没有识别出文字，可以重试。')
            setVoiceState('failure')
          }
        }
        if (event.data.type === 'error') {
          setVoiceMessage('离线识别失败，可以重试或放弃。')
          setVoiceState('failure')
          worker.terminate()
          voiceWorkerRef.current = null
        }
      }
      worker.onerror = () => {
        if (!isCurrent()) return
        setVoiceMessage('离线识别无法启动，可以重试或放弃。')
        setVoiceState('failure')
        worker.terminate()
        voiceWorkerRef.current = null
      }
      worker.postMessage({ samples }, [samples.buffer])
    } catch {
      if (!isCurrent()) return
      setVoiceMessage('录音处理失败，可以重试或放弃。')
      setVoiceState('failure')
    } finally {
      await context?.close()
    }
  }

  async function toggleVoiceRecording() {
    if (voiceState === 'recording') {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      releaseMicrophone()
      setVoiceState('transcribing')
      setVoiceMessage('我在准备把刚才的话写下来…')
      return
    }
    if (voiceState !== 'idle') return
    if (voiceConversationRef.current && (chatRequestPending || typingMessageId || sendLockRef.current)) return
    const generation = ++voiceGenerationRef.current
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' ||
      typeof AudioContext === 'undefined' || typeof OfflineAudioContext === 'undefined' || typeof Worker === 'undefined') {
      setVoiceMessage('当前浏览器暂不支持语音输入，请继续用文字记录。')
      return
    }
    try {
      setVoiceState('requesting')
      setVoiceMessage('正在请求麦克风权限…')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (voiceDisposedRef.current || generation !== voiceGenerationRef.current || activeTabRef.current !== 'chat') {
        stream.getTracks().forEach((track) => track.stop())
        if (!voiceDisposedRef.current && generation === voiceGenerationRef.current) {
          setVoiceState('idle')
          setVoiceMessage('已离开对话，这段语音没有保存。')
        }
        return
      }
      microphoneRef.current = stream
      const recorder = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = () => { releaseMicrophone(); void transcribeRecording(new Blob(chunks, { type: recorder.mimeType })) }
      recorder.onerror = () => {
        recorder.onstop = null
        if (recorder.state === 'recording') recorder.stop()
        releaseMicrophone()
        setVoiceState('idle')
        setVoiceMessage('录音出错，请重试。')
      }
      recorderRef.current = recorder
      recorder.start()
      startVoiceWave(stream)
      setVoiceState('recording')
      setRecordingSeconds(0)
      setVoiceMessage('聆听中 · 点麦克风转成文字，最长 30 秒')
      const beganAt = Date.now()
      recordingTickerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.min(30, Math.floor((Date.now() - beganAt) / 1000)))
      }, 250)
      recordingTimerRef.current = window.setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop()
          releaseMicrophone()
          setVoiceState('transcribing')
          setVoiceMessage('已经听了 30 秒，我来把这段话写下来…')
        }
      }, MAX_RECORDING_MS)
    } catch (error) {
      if (voiceDisposedRef.current || generation !== voiceGenerationRef.current) return
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.onstop = null
        recorderRef.current.stop()
      }
      releaseMicrophone()
      setVoiceState('idle')
      setVoiceMessage(error instanceof DOMException && error.name === 'NotAllowedError'
        ? '麦克风权限未开启，可在浏览器设置中允许。' : '无法开始录音，请重试。')
    }
  }

  function cancelVoiceRecording() {
    if (voiceState !== 'recording') return
    const recorder = recorderRef.current
    if (recorder) {
      recorder.onstop = null
      if (recorder.state === 'recording') recorder.stop()
    }
    releaseMicrophone()
    setVoiceState('idle')
    setVoiceMessage(voiceConversationRef.current ? '这段话没有发送，准备好可以再说一次。' :
      '已停止聆听，这段语音没有转成文字。草稿还在。')
    if (activeTabRef.current === 'chat') voiceButtonRef.current?.focus()
  }

  useEffect(() => {
    if (activeTab !== 'chat' && voiceState === 'recording') cancelVoiceRecording()
  }, [activeTab, voiceState])

  useEffect(() => {
    if (activeTab !== 'chat' && voiceConversation) closeVoiceConversation(false)
  }, [activeTab, voiceConversation])

  function abandonVoiceTranscription() {
    recordedAudioRef.current = null
    setVoiceState('idle')
    setVoiceMessage('已放弃本次语音，原有草稿已保留。')
    voiceButtonRef.current?.focus()
  }

  function retryVoiceTranscription() {
    if (recordedAudioRef.current) void transcribeRecording(recordedAudioRef.current)
  }

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
  const activeQuestionMode = activeQuestion?.provenance === 'cloud_model' ? '千问提议' : '规则模式'
  function entrySourcePreview(entryId: string | undefined, revision: number | undefined): string | null {
    if (!entryId || revision === undefined) return null
    const source = snapshot.entries.find((entry) => entry.id === entryId && entry.revision === revision)
    if (!source) return null
    const characters = Array.from(source.text.replace(/\s+/g, ' ').trim())
    if (characters.length === 0) return null
    const preview = characters.slice(0, 28).join('') + (characters.length > 28 ? '…' : '')
    return `关联第 ${session.dayForDate(source.journalDate)} 天 · 「${preview}」`
  }
  const activeEntryCitation = activeQuestion?.status === 'ready'
    ? activeQuestion.citations.find((citation) => citation.kind === 'entry') : undefined
  const activeObservationCitation = activeQuestion?.status === 'ready'
    ? activeQuestion.citations.find((citation) => citation.kind === 'observation') : undefined
  const activeObservation = snapshot.observations.find((observation) =>
    observation.id === activeObservationCitation?.id &&
    observation.revision === activeObservationCitation.revision)
  const activeSourcePreview = entrySourcePreview(activeEntryCitation?.id, activeEntryCitation?.revision) ??
    (activeObservation ? `依据你的纠正 · 「${Array.from(activeObservation.text).slice(0, 28).join('')}」` : null)
  const recordedDays = Object.keys(sourceByDate).map(date => session.dayForDate(date))
    .sort((first, second) => first - second)
  const albumDay = recordedDays.includes(viewedDay) ? viewedDay : recordedDays.at(-1) ?? day
  const album = selectAlbum(journal, albumDay) ?? (recordedDays.includes(albumDay) ? {
    spaceId: journal.spaceId, day: albumDay, title: '今天留下的事', titleRevision: 0,
    entries: [], sources: [], observations: [], observation: null,
  } : null)
  const selectedDayIndex = recordedDays.indexOf(albumDay)
  const previousAlbumDay = selectedDayIndex > 0 ? recordedDays[selectedDayIndex - 1] : null
  const nextAlbumDay = selectedDayIndex >= 0 && selectedDayIndex < recordedDays.length - 1
    ? recordedDays[selectedDayIndex + 1] : null
  const bookTurnTarget = bookTurn ? selectAlbum(journal, bookTurn.toDay) : null
  const bookBaseAlbum = bookTurnTarget ?? album
  const bookBaseIndex = bookBaseAlbum ? recordedDays.indexOf(bookBaseAlbum.day) : -1
  const bookBasePreviousDay = bookBaseIndex > 0 ? recordedDays[bookBaseIndex - 1] : null
  const bookBasePreviousAlbum = bookBasePreviousDay === null ? null : selectAlbum(journal, bookBasePreviousDay)
  const earlierEntries = journal.entries.filter((entry) => entry.day < albumDay)
  const currentPageEntries = journal.entries.filter((entry) => entry.day === albumDay)
  const firstComparedEntry = earlierEntries.find((entry) => entry.id === comparisonFirstId)
  const secondComparedEntry = currentPageEntries.find((entry) => entry.id === comparisonSecondId)
  const nextDay = nextDueDay(invitation, day)
  const dynamicNextDay = nextDay !== null && !DAYS.includes(nextDay as typeof DAYS[number]) &&
    (cadence !== 'daily' || invitation.pendingChange !== null)
  const navigationDays = [...new Set<number>([...DAYS.filter((target) => target > day), ...(dynamicNextDay ? [nextDay] : [])])]
    .sort((first, second) => first - second)
  const answeredQuestions = selectAnsweredQuestions(journal, albumDay)
    .filter((item) => !journal.entries.find((entry) => entry.id === item.answerEntryId)?.topicId.startsWith('proactive-day-'))
  const entryById = new Map(journal.entries.map((entry) => [entry.id, entry]))
  const controlsById = new Map(controlExchanges.map((exchange) => [exchange.id, exchange]))
  const visibleChatTurns = currentChatTurns(snapshot, chatTurns)
  const chatTurnByMessageId = new Map(visibleChatTurns.map((turn) => [turn.messageId, turn]))
  const callTurn = callMessageId ? chatTurnByMessageId.get(callMessageId) : undefined
  const callControl = callMessageId ? controlsById.get(callMessageId) : undefined
  const callPending = !!lastVoiceText && (chatRequestPending || !!callMessageId && typingMessageId === callMessageId)
  const callReply = callTurn ? [callTurn.response.reply, callTurn.response.nextQuestion].filter(Boolean).join('\n') :
    callControl?.reply ?? (chatError && callMessageId ? chatError :
      modelConnection.state === 'offline' && (due || extraQuestion) ? visibleQuestionText :
      callMessageId ? '已记下这句话。' : !openingDismissed ? opening.question : '想说时，随时来。')
  const conversationTimeline: TimelineItem[] = session.projectMessages(snapshot)
    .flatMap((message): TimelineItem[] => {
      if (message.entryId) {
        const entry = entryById.get(message.entryId)
        return entry ? [{ kind: 'entry' as const, order: message.sequence, messageId: message.id,
          sentAt: message.occurredAt, entry }] : []
      }
      const exchange = controlsById.get(message.id)
      return [{ kind: 'control' as const, order: message.sequence,
        messageId: message.id, sentAt: message.occurredAt, exchange, text: message.text }]
    })
  const conversationDays = [...new Set([
    ...conversationTimeline.map((item) => session.dayForTimestamp(item.sentAt)), day,
  ])].sort((first, second) => first - second)
    .map((conversationDay) => ({ day: conversationDay,
      items: conversationTimeline.filter((item) => session.dayForTimestamp(item.sentAt) === conversationDay) }))

  useLayoutEffect(() => {
    if (activeTab !== 'chat' || !chatScrollRef.current) return
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [activeTab, day, journal.entries.length, controlExchanges.length, questionIndex, extraQuestion,
    chatTurns.length, modelConnection.state, typingMessageId])

  useEffect(() => {
    setChatTurns((current) => {
      const valid = currentChatTurns(snapshot, current)
      return valid.length === current.length ? current : valid
    })
  }, [snapshot])

  function refresh() {
    setSnapshot(session.read())
  }

  function cancelPendingChat() {
    sendGenerationRef.current += 1
    sendLockRef.current = false
    modelStatusControllerRef.current?.abort()
    modelStatusControllerRef.current = null
    chatControllerRef.current?.abort()
    chatControllerRef.current = null
    if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current)
    replyTimerRef.current = null
    setTypingMessageId(null)
    setChatRequestPending(false)
    setChatError('')
  }

  async function requestModelReply(messageId: string, generation: number) {
    const latest = session.read()
    const messages = session.projectMessages(latest)
    const message = messages.find((item) => item.id === messageId)
    if (!message) return
    const messageDay = session.dayForTimestamp(message.occurredAt)
    const turn = sourceForMessage(latest, message, messageDay)
    if (!turn || !sourceIsCurrent(latest, turn)) return
    const validPreviousTurns = currentChatTurns(latest, chatTurns)
    const previouslySentMessageIds = new Set(validPreviousTurns.map((item) => item.messageId))
    const context = messages.filter((item) => item.sequence < message.sequence &&
      session.dayForTimestamp(item.occurredAt) === messageDay &&
      previouslySentMessageIds.has(item.id)).reverse()
      .map((item) => sourceForMessage(latest, item, messageDay))
      .filter((item): item is PrivateChatSource => !!item && sourceIsCurrent(latest, item))
      .slice(0, 2)
    const preceding = validPreviousTurns.filter((item) => {
      const sourceMessage = messages.find((candidate) => candidate.id === item.messageId)
      return !!sourceMessage && session.dayForTimestamp(sourceMessage.occurredAt) === messageDay
    }).at(-1)
    const request: PrivateChatRequest = {
      turn, context,
      ...(!preceding && !openingDismissed && !invitation.paused && messageDay === 1 &&
        messages[0]?.id === messageId ? { openingId } : {}),
      ...(preceding ? { precedingAssistant: {
        reply: preceding.response.reply, nextQuestion: preceding.response.nextQuestion,
      } } : {}),
    }
    if (!validChatRequest(request)) {
      const error = '这句已保存在本页，但长度或上下文超出模型请求范围，没有自动发送。'
      setChatError(error)
      setStatus(error)
      return
    }
    const controller = new AbortController()
    chatControllerRef.current = controller
    setTypingMessageId(messageId)
    try {
      const response = await requestPrivateChat(request, controller.signal)
      if (controller.signal.aborted || chatControllerRef.current !== controller ||
        sendGenerationRef.current !== generation) return
      const current = session.read()
      const sourceStillCurrent = [request.turn, ...request.context]
        .every((source) => sourceIsCurrent(current, source))
      const precedingStillCurrent = !request.precedingAssistant ||
        currentChatTurns(current, chatTurns).some((item) => item.messageId === preceding?.messageId)
      if (!sourceStillCurrent || !precedingStillCurrent ||
        !current.messages.some((item) => item.id === messageId)) {
        const error = '等待回复时原话或上下文已变化；这次模型结果没有显示。'
        setChatError(error)
        setStatus(error)
        return
      }
      const result: PrivateChatTurn = {
        messageId, request, response,
        ...(preceding ? { precedingMessageId: preceding.messageId } : {}),
      }
      setChatTurns((existing) => [...currentChatTurns(current, existing), result])
      setModelConnection({ state: 'ready', modelName: response.model.id })
      setChatError('')
      setStatus('模型已回复；回复不会写成你的画册事实。')
    } catch (error) {
      if (controller.signal.aborted || sendGenerationRef.current !== generation) return
      const safeError = chatFailureCopy(error)
      setChatError(safeError)
      setStatus(safeError)
      if (!(error instanceof PrivateChatRequestError) ||
        ['model_not_configured', 'model_unavailable', 'model_timeout', 'rate_limited'].includes(error.code)) {
        setModelConnection((current) => ({ ...current, state: 'offline' }))
      }
    } finally {
      if (chatControllerRef.current === controller) {
        chatControllerRef.current = null
        setTypingMessageId(null)
      }
    }
  }

  function showQuestion(targetDay: number, moment = false) {
    const next = session.displayNextQuestion(targetDay, moment)
    setActiveQuestionId(next.id)
    setCorrectingQuestion(false)
    setCorrectionDraft('')
    refresh()
  }

  function saveQuestionCorrection() {
    const question = session.read().questions.find((item) => item.id === activeQuestionId)
    const citation = question?.citations[0]
    if (!question || question.provenance !== 'cloud_model' || question.status !== 'ready' ||
      !citation || citation.kind !== 'entry' || !correctionDraft.trim()) return
    try {
      session.recordQuestionCorrection({
        day,
        questionId: question.id, expectedQuestionRevision: question.revision,
        entryCitation: { id: citation.id, revision: citation.revision },
        text: correctionDraft.trim(), expectedSpaceRevision: session.read().revision,
      })
      setViewedDay(day)
      showQuestion(day)
      setStatus('已记下你的纠正，当天画册会显示这次补充；接下来的问题改用它作依据。')
    } catch {
      setStatus('问题或来源已变化，请重新查看后再纠正。')
      refresh()
    }
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
    if (albumEditing && target !== albumDay) { setStatus('画册正在编辑，请先保存、取消或下载草稿，再切换日期。'); return }
    if (bookTurnTimerRef.current !== null) {
      window.clearTimeout(bookTurnTimerRef.current)
      bookTurnTimerRef.current = null
    }
    setBookTurn(null)
    setViewedDay(target)
    setComparisonFirstId('')
    setComparisonSecondId('')
    setEditingId(null)
    setEditDraft('')
    setEditingTitle(false)
    setTitleDraft('')
    setPrintPending(false)
    setPendingEntryChange(null)
  }

  function turnAlbum(direction: 'next' | 'previous') {
    if (albumEditing) { setStatus('请先保存、取消或下载编辑草稿，再翻到其他日期。'); return }
    if (bookTurn || selectedDayIndex < 0) return
    const targetDay = recordedDays[selectedDayIndex + (direction === 'next' ? 1 : -1)]
    if (targetDay === undefined) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      viewRecordedDay(targetDay)
      return
    }
    setBookTurn({ direction, fromDay: albumDay, toDay: targetDay })
    bookTurnTimerRef.current = window.setTimeout(() => {
      bookTurnTimerRef.current = null
      viewRecordedDay(targetDay)
    }, BOOK_TURN_FALLBACK_MS)
  }

  function completeBookTurn() {
    if (bookTurn) viewRecordedDay(bookTurn.toDay)
  }

  function advanceDay(target: number) {
    if (albumEditing) { setStatus('请先保存或取消画册编辑，再推进演示日期。'); return }
    if (target <= day) return
    if (settingsRef.current?.open) {
      settingsRef.current.open = false
      settingsRef.current.querySelector('summary')?.focus()
    }
    cancelPendingChat()
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

  function beginLocalReply(messageId: string) {
    if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current)
    setTypingMessageId(messageId)
    replyTimerRef.current = window.setTimeout(() => {
      replyTimerRef.current = null
      setTypingMessageId((current) => current === messageId ? null : current)
    }, REPLY_DELAY_MS)
  }

  async function sendMessage(voiceText?: string) {
    const text = (voiceText ?? draft).trim()
    if (!text || sendLockRef.current || typingMessageId || (voiceState !== 'idle' && voiceText === undefined)) return
    const voiceGeneration = voiceText === undefined ? null : voiceGenerationRef.current
    sendLockRef.current = true
    const generation = ++sendGenerationRef.current
    setChatRequestPending(true)
    setChatError('')
    if (voiceText === undefined) setDraft('')
    try {
    let connection = modelConnection
    if (privateChatAvailableOnThisHost(window.location.hostname) && connection.state !== 'ready') {
      modelStatusControllerRef.current?.abort()
      const probe = new AbortController()
      modelStatusControllerRef.current = probe
      const timeout = window.setTimeout(() => probe.abort(), 1800)
      try {
        connection = await readModelConnection(probe.signal)
      } catch {
        connection = { state: 'offline', modelName: connection.modelName }
      } finally {
        window.clearTimeout(timeout)
        if (modelStatusControllerRef.current === probe) modelStatusControllerRef.current = null
      }
      if (voiceDisposedRef.current) return
      if (sendGenerationRef.current !== generation) {
        if (voiceText === undefined) setDraft((current) => current || text)
        return
      }
      setModelConnection(connection)
    }
    if (voiceText !== undefined && (!voiceConversationRef.current || voiceGeneration !== voiceGenerationRef.current)) return
    const useModel = connection.state === 'ready'
    const intent = classifyChatIntent(text)
    const promptId = !useModel && (due || extraQuestion) ? activeQuestionId : null
    let result: ReturnType<typeof session.sendMessage>
    try {
      result = session.sendMessage(day, text, promptId)
    } catch {
      if (voiceText === undefined) setDraft((current) => current || text)
      setStatus('这句话暂时没有保存，请重试。')
      return
    }
    if (voiceText !== undefined && voiceConversationRef.current) setCallMessageId(result.message.id)
    refresh()
    if (result.entry) setViewedDay(day)
    if (useModel) {
      if (result.entry) {
        setInvitation(shareProactively(invitation))
        setAnsweredInRound(true)
      }
      await requestModelReply(result.message.id, generation)
      return
    }
    if (intent === 'skip' || intent === 'decline') {
      beginLocalReply(result.message.id)
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
      beginLocalReply(result.message.id)
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
    else { beginLocalReply(result.message.id); answerQuestion() }
    } finally {
      if (sendGenerationRef.current === generation) {
        sendLockRef.current = false
        setChatRequestPending(false)
      }
    }
  }

  function applyEntryChange(change: EntryChange) {
    if (albumEditing && change.kind === 'deleteEntry') {
      setPendingEntryChange(null)
      setStatus('请先保存或取消画册编辑，再删除原话，避免丢失编辑草稿。')
      return
    }
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
      cancelPendingChat()
      if (change.kind === 'editEntry') session.editEntry(change.id, change.text)
      else session.deleteEntry(change.id)
      setChatTurns((existing) => currentChatTurns(session.read(), existing))
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
    showTitleConfirmation(change)
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
      if (session.read().messages.length === 0) setOpeningDismissed(true)
      setInvitation(pauseInvitations(invitation))
      setExtraQuestion(false)
      setStatus('邀请已暂停；暂停期间不会补发。')
    }
  }

  function toggleConsent(source: BehaviorSource) {
    setConsents((current) => ({ ...current, [source]: !current[source] }))
  }

  function closeDetails() {
    detailsDialogRef.current?.close()
    detailsTriggerRef.current?.focus()
  }

  return (
    <main className={'product-shell product-tab-' + activeTab + (voiceConversation ? ' product-shell-call' : '')} aria-label="渐知产品">
      <nav className="product-nav screen-only" aria-label="产品导航" hidden={voiceConversation}>
        <div className="product-brand"><span className="product-brand-mark"><ProductIcon name="album" /></span>
          <strong>渐知</strong><small>慢慢认识你</small></div>
        <div className="product-nav-links">
          <button type="button" aria-current={activeTab === 'chat' ? 'page' : undefined} onClick={() => setActiveTab('chat')}><ProductIcon name="chat" /><span>对话</span></button>
          <button type="button" aria-current={activeTab === 'album' ? 'page' : undefined} onClick={() => setActiveTab('album')}><ProductIcon name="album" /><span>画册</span></button>
          <button type="button" aria-current={activeTab === 'data' ? 'page' : undefined} onClick={() => setActiveTab('data')}><ProductIcon name="data" /><span>生活数据</span></button>
        </div>
        <div className="messenger-contact-preview" hidden={activeTab !== 'chat'}>
          <ChatAvatar src={companionSrc} /><div><strong>{companion.name}</strong><p>想说时，就在这里。</p></div>
        </div>
        <div className="product-nav-foot">
          <button type="button" className="product-clear" onClick={onReset} aria-label="清除本次内容">清除</button>
          <button type="button" className="product-details-trigger" ref={detailsTriggerRef}
            onClick={() => detailsDialogRef.current?.showModal()}>详情 <span aria-hidden="true">↗</span></button>
        </div>
      </nav>
      <div className="product-workspace">
        {activeTab === 'album' && <h1 className="product-sr-title">翻开画册</h1>}
        {storageError && <div className="storage-warning screen-only" role="alert"><p>{storageError} 当前修改尚未可靠保存，请在画册背面下载 .md。</p><button type="button" onClick={downloadCacheBackup}>下载原缓存备份</button></div>}
        {status && <p ref={statusRef} className="free-status product-status screen-only" role="status" tabIndex={-1}>{status}</p>}
        <div className="product-content">
          {voiceConversation && activeTab === 'chat' && <section className="product-call-screen screen-only"
            aria-label="渐知语音通话">
            <div className="product-call-stage">
              <div className={`product-call-portrait${voiceState === 'recording' ? ' is-listening' : ''}`}>
                <img src={companionSrc} alt={`${companion.name}，渐知的${companion.label}伙伴`} />
              </div>
              <h1>{voiceState === 'recording' ? '聆听中' : voiceState === 'transcribing' ?
                voiceDelivery ? '正在写下你的话' : '正在整理你说的话' : callPending ?
                `${companion.name}正在回应` : voiceState === 'failure' ? '没能听清这次' : '准备听你说'}</h1>
              <div className="product-call-dialogue" aria-live="polite">
                {lastVoiceText && !voiceDelivery && <p className="product-call-said">{lastVoiceText}</p>}
                <p className="product-call-reply">{callPending ? `稍等，${companion.name}正在输入…` :
                  voiceDelivery || voiceState === 'transcribing' ? ' ' : callReply}</p>
                {(voiceState === 'failure' || voiceState === 'idle' && voiceMessage) &&
                  <p className="product-call-feedback" role="status">{voiceMessage}</p>}
              </div>
            </div>
            <div className="product-call-controls">
              <div className="product-call-transcript" aria-label="本次语音文字" aria-busy={voiceState === 'transcribing'}>
                {voiceDelivery ? <p>{Array.from(voiceDelivery.text).slice(0, voiceDelivery.shown).join('')}<span className="product-transcript-caret" aria-hidden="true" /></p> :
                  voiceState === 'recording' ? <div className="product-wave" aria-hidden="true">
                    <canvas ref={voiceCanvasRef} /><span className="product-wave-still" />
                  </div> : null}
              </div>
              <div className="product-call-actions">
                <button type="button" className="product-call-mic"
                  ref={(node) => {
                    voiceButtonRef.current = node
                    voiceRetryRef.current = voiceState === 'failure' ? node : null
                  }}
                  aria-label={voiceState === 'failure' ? '重试转写' : voiceState === 'recording'
                    ? '说完了，转写并发送' : '开始语音对话聆听'}
                  aria-pressed={voiceState === 'recording'}
                  disabled={chatRequestPending || !!typingMessageId || !['idle', 'recording', 'failure'].includes(voiceState)}
                  onClick={() => voiceState === 'failure' ? retryVoiceTranscription() : void toggleVoiceRecording()}>
                  {voiceState === 'recording' ? <span className="product-voice-stop" aria-hidden="true" /> :
                    <MicrophoneIcon size={28} />}
                </button>
                <button type="button" className="product-call-exit" aria-label="退出语音通话"
                  title="退出语音通话" onClick={() => closeVoiceConversation()}>
                  <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <time className="product-call-time"
                aria-label={`通话已进行 ${Math.floor(callSeconds / 60)} 分 ${callSeconds % 60} 秒`}>
                {String(Math.floor(callSeconds / 60)).padStart(2, '0')}:
                {String(callSeconds % 60).padStart(2, '0')}
              </time>
            </div>
          </section>}
          <section className="product-chat screen-only" aria-label="对话记录" hidden={activeTab !== 'chat' || voiceConversation}>
            <header className="messenger-header">
              <div className="messenger-contact"><ChatAvatar src={companionSrc} /><div><h1>{companion.name}</h1><p>AI 记录伙伴</p></div></div>
              <div className="messenger-header-actions">
                {modelConnection.state === 'offline' && <span className="messenger-offline">暂时离线 · 仍可记录</span>}
                <details className="messenger-companion-picker" ref={companionPickerRef}>
                  <summary aria-label="选择伙伴" title="换个伙伴"><img src={companionSrc} alt="" />
                    <span>换个伙伴</span><span aria-hidden="true">⌄</span></summary>
                  <div className="messenger-companion-options" role="group" aria-label="渐知伙伴">
                    {COMPANIONS.map((item) => <button type="button" key={item.id}
                      aria-pressed={companionId === item.id} aria-label={`${item.name}，${item.label}形象`}
                      onClick={() => {
                        setCompanionId(item.id)
                        if (companionPickerRef.current) {
                          companionPickerRef.current.open = false
                          companionPickerRef.current.querySelector('summary')?.focus()
                        }
                      }}>
                      <img src={companionImage(item.id)} alt="" />
                      <strong>{item.name}</strong>
                    </button>)}
                  </div>
                </details>
                <details className="product-settings" ref={settingsRef}><summary aria-label="邀请节奏与演示日期" title="聊天设置">邀请节奏与演示日期<ProductIcon name="more" /></summary>
                  <div className="messenger-settings-panel"><h2>聊天设置</h2>
                <div className="messenger-model-status" aria-label="模型状态" aria-live="polite">
                  <span>{modelConnection.state === 'checking' ? '正在检查本机模型…' :
                    modelConnection.state === 'ready' ? `当前模型：${modelConnection.modelName}（本机已配置）` :
                      modelConnection.modelName ? `当前模型：${modelConnection.modelName}（暂不可用）` :
                        '模型未连接 · 本地记录'}</span>
                </div>
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
                  </div>
                </details>
              </div>
            </header>
            <div className="product-chat-scroll" ref={chatScrollRef}>
              {conversationDays.map(({ day: conversationDay, items }) => <section className="product-chat-day"
                aria-label={'第 ' + conversationDay + ' 天对话'} key={conversationDay}>
              <p className="product-day-divider"><span>
                {items[0] ? chatLocalDateTime(items[0].sentAt, session.timezone).detailed : session.dateForDay(conversationDay)}
                {conversationDay > 1 && <small>演示第 {conversationDay} 天</small>}</span></p>
              <div className="product-thread">
                {conversationDay === 1 && !openingDismissed && <div className="product-bubble-row agent messenger-opening"
                  aria-label="小册的开场白">
                  <ChatAvatar src={companionSrc} />
                  <div className="product-bubble"><p>{opening.greeting}</p><p>{opening.question}</p></div>
                </div>}
                {items.map((item, index) => {
                  const marker = chatTimeMarker(items[index - 1], item, session.timezone)
                  if (item.kind === 'control') return <div className="product-exchange" key={item.messageId}>
                    {marker && <p className="product-time-divider"><time dateTime={item.sentAt}>{marker}</time></p>}
                    {item.exchange?.promptQuestionId && (openingDismissed || item.exchange.promptQuestionId !== session.firstQuestionId) && <div className="product-bubble-row agent">
                      <ChatAvatar src={companionSrc} />
                      <div className="product-bubble"><small>渐知 · 当时的问题</small>
                        <p>{snapshot.questions.find((question) => question.id === item.exchange?.promptQuestionId)?.text ?? '旧提问已撤下。'}</p></div>
                    </div>}
                    <div className="product-bubble-row user"><div className="product-bubble"><p>{item.text}</p></div><ChatAvatar user /></div>
                    {item.exchange?.reply && typingMessageId !== item.messageId && <div className="product-bubble-row agent"><ChatAvatar src={companionSrc} />
                      <div className="product-bubble"><p>{item.exchange.reply}</p></div></div>}
                    {chatTurnByMessageId.get(item.messageId) && <div className="product-bubble-row agent">
                      <ChatAvatar src={companionSrc} />
                      <div className="product-bubble product-ai-reply"><small>千问 · AI 回复</small>
                        <p>{chatTurnByMessageId.get(item.messageId)!.response.reply}</p>
                        {chatTurnByMessageId.get(item.messageId)!.response.nextQuestion &&
                          <p className="product-ai-followup">{chatTurnByMessageId.get(item.messageId)!.response.nextQuestion}</p>}
                      </div></div>}
                  </div>
                  const entry = item.entry
                  const answered = selectAnsweredQuestions(journal, entry.day)
                    .find((questionRecord) => questionRecord.answerEntryId === entry.id)
                  const answeredSourcePreview = answered?.status === 'ready'
                    ? entrySourcePreview(answered.citationEntryId, answered.citationEntryRevision) : null
                  const isProactive = entry.topicId.startsWith('proactive-day-')
                  return <div className="product-exchange" key={entry.id}>
                    {marker && <p className="product-time-divider"><time dateTime={item.sentAt}>{marker}</time></p>}
                    {answered && !isProactive && (openingDismissed || snapshot.questions.find((question) =>
                      question.id === session.firstQuestionId)?.answeredByMessageId !== item.messageId) && <div className="product-bubble-row agent">
                      <ChatAvatar src={companionSrc} />
                      <div className="product-bubble"><small>渐知 · {answered.mode === 'cloud' ? '千问提议的问题' : '当时的规则问题'}</small>
                        <p>{answered.status === 'ready' ? answered.text :
                          answered.status === 'reference-deleted' ? '这题引用的原话已删除。' : '这题引用的原话已有修订。'}</p>
                        {answeredSourcePreview && <small className="product-question-source">{answeredSourcePreview}</small>}
                        {answered.mode === 'cloud' && answered.status === 'ready' && answered.approvedExcerpt &&
                          <details className="product-question-evidence"><summary>查看当时发送给千问的片段</summary>
                            <blockquote>“{answered.approvedExcerpt}”</blockquote></details>}</div>
                    </div>}
                    <div className="product-bubble-row user"><div className="product-bubble">
                      <p>{entry.text}</p>
                      {entry.revision > 1 && <span className="messenger-revision">已修订</span>}
                    </div><ChatAvatar user /></div>
                    {chatTurnByMessageId.get(item.messageId) && <div className="product-bubble-row agent">
                      <ChatAvatar src={companionSrc} />
                      <div className="product-bubble product-ai-reply"><small>千问 · AI 回复</small>
                        <p>{chatTurnByMessageId.get(item.messageId)!.response.reply}</p>
                        {chatTurnByMessageId.get(item.messageId)!.response.nextQuestion &&
                          <p className="product-ai-followup">{chatTurnByMessageId.get(item.messageId)!.response.nextQuestion}</p>}
                      </div></div>}
                  </div>
                })}
                {journal.observations.filter((observation) => observation.day === conversationDay &&
                  observation.status === 'corrected').map((correction) => <div className="product-bubble-row user"
                  aria-label="你补充的纠正" key={correction.id}>
                  <div className="product-bubble"><small>你补充的准确背景 · 仅留本页</small><p>{correction.text}</p></div><ChatAvatar user />
                </div>)}
                {conversationDay === day && modelConnection.state === 'offline' && !chatError &&
                  !typingMessageId && (due || extraQuestion) &&
                  (openingDismissed || activeQuestionId !== session.firstQuestionId) && <div className="product-bubble-row agent current">
                  <ChatAvatar src={companionSrc} />
                  <div className="product-bubble"><small>第 {day} 天 · {extraQuestion ? '主动第 3 题' : '第 ' + (questionIndex + 1) + ' 题'} · {activeQuestionMode}</small>
                    <p>{visibleQuestionText}</p>
                    {activeSourcePreview && <small className="product-question-source">{activeSourcePreview}</small>}
                    {activeQuestion?.provenance === 'cloud_model' && activeQuestion.approvedExcerpt &&
                      <details className="product-question-evidence"><summary>查看这次发送给千问的片段</summary>
                        <blockquote>“{activeQuestion.approvedExcerpt}”</blockquote></details>}
                    {activeQuestion?.provenance === 'cloud_model' && <div className="product-question-correction">
                      {!correctingQuestion ? <button type="button" className="product-question-action" onClick={() => setCorrectingQuestion(true)}>理解偏了？补充背景</button> : <>
                        <label htmlFor="private-correction">哪里不准确？用你的话写下更准确的背景</label>
                        <textarea id="private-correction" value={correctionDraft} maxLength={1000} rows={3}
                          onChange={(event) => setCorrectionDraft(event.target.value)} />
                        <div><button type="button" onClick={() => { setCorrectingQuestion(false); setCorrectionDraft('') }}>取消</button>
                          <button type="button" onClick={saveQuestionCorrection} disabled={!correctionDraft.trim()}>记下纠正并换一问</button></div>
                      </>}
                    </div>}</div>
                </div>}
                {conversationDay === day && modelConnection.state === 'offline' && !chatError &&
                  !typingMessageId && !due && !extraQuestion && <div className="product-rest" role="note">
                  <strong>{roundClosed ? '今天的邀请已结束' : '第 ' + day + ' 天不邀请'}</strong>
                  <p>{roundClosed ? '今天可以停在这里，也可以自己再记一句。' :
                    '未展示的日期不会补发问题；想记事时仍可直接留言。'}</p>
                  {!roundClosed && cadence === 'weekly' && nextDay !== null && <p className="product-next-hint">下次邀请在第 {nextDay} 天</p>}
                </div>}
                {conversationDay === day && chatError && <div className="product-rest" role="alert"><p>{chatError}</p></div>}
                {conversationDay === day && typingMessageId && <div className="product-bubble-row agent product-typing" aria-live="polite">
                  <ChatAvatar src={companionSrc} />
                  <div className="product-bubble"><span>{companion.name}正在输入</span>
                    <span className="product-typing-dots" aria-hidden="true"><i /><i /><i /></span></div>
                </div>}
              </div>
              </section>)}
            </div>
            <div className="product-chat-controls">
              <div className="product-composer" data-voice-state={voiceState}>
                <div className="product-composer-input" aria-busy={voiceState === 'transcribing'}>
                  {voiceState === 'idle' ? <>
                    <label htmlFor="free-message">发送消息</label>
                    <textarea id="free-message" ref={messageInputRef} value={draft} maxLength={10000}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault(); void sendMessage()
                        }
                      }} rows={1} placeholder="想说什么，慢慢说…" />
                  </> : voiceState === 'recording' ? <div className="product-voice-panel">
                    <div className="product-wave" aria-hidden="true"><canvas ref={voiceConversation ? undefined : voiceCanvasRef} />
                      <span className="product-wave-still" /></div>
                    <div className="product-voice-panel-foot">
                      <span className="product-recording-label"><i aria-hidden="true" />聆听中
                        <time aria-label={`录音时长 ${Math.floor(recordingSeconds / 60)} 分 ${recordingSeconds % 60} 秒`}>
                          {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
                          {String(recordingSeconds % 60).padStart(2, '0')}</time></span>
                      <button type="button" className="product-voice-text-action" onClick={cancelVoiceRecording}
                        aria-label="停止聆听并放弃本次语音">停止聆听</button>
                    </div>
                  </div> : voiceState === 'failure' ? <div className="product-voice-state product-voice-failure">
                    <p>{voiceMessage}</p><div>
                      <button type="button" ref={voiceConversation ? undefined : voiceRetryRef} onClick={retryVoiceTranscription}>重试转写</button>
                      <button type="button" onClick={abandonVoiceTranscription}>放弃本次语音</button>
                    </div>
                  </div> : <div className="product-voice-state">
                    <span className="product-voice-progress" aria-hidden="true" />
                    <p>{voiceState === 'requesting' ? '等待麦克风授权…' : voiceMessage}</p>
                  </div>}
                </div>
                <div className="product-composer-toolbar">
                  <div className="product-composer-actions">
                  <button type="button" className="product-call-entry" ref={voiceEntryRef}
                    disabled={voiceState !== 'idle' || chatRequestPending || !!typingMessageId}
                    onClick={openVoiceConversation} aria-label="语音对话" title="语音对话">
                    <ProductIcon name="phone" />
                  </button>
                  <button type="button" className="product-voice" ref={voiceConversation ? undefined : voiceButtonRef}
                    onClick={() => void toggleVoiceRecording()}
                    disabled={(voiceState !== 'idle' && voiceState !== 'recording') || chatRequestPending}
                    aria-pressed={voiceState === 'recording'} aria-busy={voiceState === 'transcribing'}
                    aria-label={voiceState === 'recording' ? '结束聆听并转成文字' :
                      voiceState === 'transcribing' ? '正在转写' : '开始语音输入'}
                    title={voiceState === 'recording' ? '结束聆听并转成文字' : '语音输入（本机识别）'}>
                    {voiceState === 'recording' ? <span className="product-voice-stop" aria-hidden="true" /> :
                      <MicrophoneIcon />}
                  </button>
                  <button type="button" className="product-send" onClick={() => {
                    void sendMessage(); messageInputRef.current?.focus()
                  }}
                    disabled={!draft.trim() || chatRequestPending || !!typingMessageId || voiceState !== 'idle'}>发送</button>
                  </div>
                </div>
                <p className="messenger-input-hint">{storageError ? '本机保存遇到问题，请下载备份。' : '已保存在此浏览器 · 发送范围见「详情」。'}<span>Enter 发送 · Shift + Enter 换行</span></p>
                {recordedDays.length > 0 && <button type="button" className="messenger-open-page" onClick={() => { setViewedDay(day); setActiveTab('album') }}>看看今天这一页 <span aria-hidden="true">→</span></button>}
                {voiceMessage && <p className="product-composer-note" role="status" aria-live="polite">{voiceMessage}</p>}
              </div>
            </div>
          </section>

          <section className="product-album" aria-label="过往记录" hidden={activeTab !== 'album'}>
            {recordedDays.length > 0 && <div className="product-album-bar screen-only">
              <nav className="free-day-nav product-album-days" aria-label="有记录日期">
                {recordedDays.map((target) => {
                const dayAlbum = selectAlbum(journal, target)
                const correctionCount = dayAlbum?.observations.filter((item) => item.status === 'corrected').length ?? 0
                return <button type="button" key={target}
                  aria-label={'查看第 ' + target + ' 天'} aria-current={albumDay === target ? 'date' : undefined}
                  onClick={() => viewRecordedDay(target)}>
                  <strong>{session.dateForDay(target).slice(5).replace('-', '.')}</strong>
                  <small>第 {target} 天 · {sourceByDate[session.dateForDay(target)]?.filter(message => message.role === 'user').length ?? 0} 段话
                    {correctionCount > 0 && ` · ${correctionCount} 条纠正`}</small></button>
                })}
              </nav>
              {album && <button type="button" className="guided-print" onClick={openPrintReminder}
                disabled={bookTurn !== null}>打印当前页 ↗</button>}
            </div>}
            {album ? <>
              <div className="product-album-book-wrap">
                <div className={`product-album-book${bookTurn ? ` is-turning-${bookTurn.direction}` : ''}`}
                  role="group" aria-label="双页翻书画册">
                  <span className="album-book-binding" aria-hidden="true" />
                  <section className="album-book-page album-book-page-left"
                    aria-label={bookBasePreviousAlbum ? `第 ${bookBasePreviousAlbum.day} 天画册预览` : '画册扉页'}>
                    <AlbumPreviewPage album={bookBasePreviousAlbum} openingDay={bookBaseAlbum?.day ?? albumDay}
                      dateForDay={(target) => session.dateForDay(target)} onOpen={viewRecordedDay} />
                  </section>
                  <div className="album-book-page album-book-page-right">
                    <DailyAlbum key={bookBaseAlbum?.day ?? albumDay}
                      record={dailyRecords[session.dateForDay(bookBaseAlbum?.day ?? albumDay)] ?? createDailyRecord(session.dateForDay(bookBaseAlbum?.day ?? albumDay), sourceByDate[session.dateForDay(bookBaseAlbum?.day ?? albumDay)] ?? [])}
                      onSave={saveDailyRecord} onEditingChange={setAlbumEditing} timezone={snapshot.timezone} modelReady={modelConnection.state === 'ready'} />
                  </div>
                  {bookTurn && bookTurnTarget && <div className={`album-turn-sheet album-turn-${bookTurn.direction}`}
                    aria-hidden="true" inert onAnimationEnd={completeBookTurn}>
                    {bookTurn.direction === 'previous'
                      ? <div className="album-turn-face album-turn-front album-turn-preview">
                        <AlbumPreviewPage album={bookBasePreviousAlbum} openingDay={bookTurn.toDay}
                          dateForDay={(target) => session.dateForDay(target)} />
                      </div>
                      : <div className="album-turn-face album-turn-front">
                        <AlbumPage mode="private" album={album} journal={journal}
                          dateForDay={(target) => '第 ' + target + ' 天'}
                          displayDateForDay={(target) => `演示日期 ${session.dateForDay(target)} · 第 ${target} 天`} />
                      </div>}
                    <div className="album-turn-face album-turn-back" />
                  </div>}
                </div>
                <div className="album-book-controls screen-only" aria-label="画册翻页控制">
                  <button type="button" disabled={previousAlbumDay === null || bookTurn !== null}
                    onClick={() => turnAlbum('previous')} aria-label="翻到前一个有记录日期"><span>←</span> 前一天</button>
                  <p role="status" aria-live="polite">
                    <strong>{session.dateForDay(albumDay).slice(5).replace('-', '.')}</strong>
                    <span>第 {String(selectedDayIndex + 1).padStart(2, '0')} / {String(recordedDays.length).padStart(2, '0')} 页</span>
                  </p>
                  <button type="button" disabled={nextAlbumDay === null || bookTurn !== null}
                    onClick={() => turnAlbum('next')} aria-label="翻到后一个有记录日期">后一天 <span>→</span></button>
                </div>
              </div>
              <details className="product-album-foldout product-album-tools screen-only">
                <summary><span>页面工具</span><small>3 项 · 整理、对照与提问</small></summary>
              <details className="daily-legacy-evidence"><summary>原话与观察依据</summary>
                <AlbumPage mode="private" album={album} journal={journal} dateForDay={(target) => '第 ' + target + ' 天'}
                  displayDateForDay={(target) => session.dateForDay(target)} />
              </details>
              <section className="free-record-tools product-record-tools" aria-label="记录管理">
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
              <section className="free-comparison guided-comparison product-comparison"
              role="region" aria-label="前后两页摘录">
              <div className="guided-comparison-heading"><span className="guided-section-index">与过去相比</span>
                <h2>前后两页摘录</h2><p>从不同记录日亲手选择两条原话并列；系统不判断话题是否相关，也不推断变化原因。</p></div>
              {earlierEntries.length > 0 && currentPageEntries.length > 0 && <div className="product-compare-picker">
                <label>较早的一条
                  <select value={firstComparedEntry?.id ?? ''} onChange={(event) => setComparisonFirstId(event.target.value)}>
                    <option value="">请选择</option>
                    {earlierEntries.map((entry) => <option key={entry.id} value={entry.id}>
                      第 {entry.day} 天 · {Array.from(entry.text).slice(0, 24).join('')}
                    </option>)}
                  </select>
                </label>
                <label>当前页的一条
                  <select value={secondComparedEntry?.id ?? ''} onChange={(event) => setComparisonSecondId(event.target.value)}>
                    <option value="">请选择</option>
                    {currentPageEntries.map((entry) => <option key={entry.id} value={entry.id}>
                      第 {entry.day} 天 · {Array.from(entry.text).slice(0, 24).join('')}
                    </option>)}
                  </select>
                </label>
              </div>}
              {firstComparedEntry && secondComparedEntry ? <div className="guided-comparison-pages">
                {[firstComparedEntry, secondComparedEntry].map((entry) => <div key={entry.id}>
                  <span>第 {entry.day} 天</span><blockquote>“{entry.text}”</blockquote>
                  <small>来源：{entry.source} · 演示日期时间 {entry.occurredAt.slice(0, 16).replace('T', ' ')}<br />
                    本次录入时间 {entry.recordedAt.slice(0, 16).replace('T', ' ')}
                    {entry.revision > 1 && ` · 当前第 ${entry.revision} 版`}</small>
                </div>)}
              </div> : <p className="free-insufficient">{earlierEntries.length > 0 && currentPageEntries.length > 0
                ? '请选择两条原话，看看你自己注意到什么。' : '资料不足，暂时无法对照两天原话。'}</p>}
            </section>
              <section className="free-question-history product-question-history"
              role="region" aria-label="已回答问题">
              <h2>本日已回答问题</h2>
              {answeredQuestions.length > 0 ? <ol>{answeredQuestions.map((item, index) => <li key={albumDay + '-' + index}>
                <span>第 {albumDay} 天 · {item.status === 'reference-revised' ? '引用已有修订' :
                  item.status === 'reference-deleted' ? '引用已删除' : item.mode === 'cloud' ? '千问提议' : '规则问题'}</span>
                <p>{item.status === 'ready' ? item.text :
                  item.status === 'reference-deleted' ? '这题引用的原话已删除。' : '这题引用的原话已有修订。'}</p>
                {item.status === 'ready' && item.mode === 'cloud' && item.approvedExcerpt &&
                  <details className="product-question-evidence"><summary>查看当时发送的片段</summary>
                    <blockquote>“{item.approvedExcerpt}”</blockquote></details>}
              </li>)}</ol> : <p>这一天没有已回答的问题。</p>}
            </section>
              </details>
            </> : <div className="product-album-empty screen-only">
              <p className="album-empty-eyebrow">渐知 · 你的生活画册</p><h2>日子，值得慢慢翻阅。</h2>
              <p>聊一句，留下你的第一页。正面回看生活，背面保留完整记录。</p>
              <button type="button" onClick={() => setActiveTab('chat')}>去对话</button>
              <div className="album-sample-preview"><DailyAlbum record={sample} onSave={setSample} modelReady={false} sample /></div>
              <button type="button" className="album-reset-sample" onClick={() => setSample(exampleRecord())}>重置这份示例</button>
            </div>}
          </section>

          <section className="product-data screen-only" aria-label="生活数据" hidden={activeTab !== 'data'}>
            <DataInsights consents={consents} onToggle={toggleConsent} />
          </section>
        </div>
      </div>
      <dialog ref={detailsDialogRef} className="free-print-dialog product-details-dialog screen-only"
        aria-labelledby="product-details-title"
        onCancel={(event) => { event.preventDefault(); closeDetails() }}>
        <p className="guided-section-index">关于这个演示</p>
        <h2 id="product-details-title">详情</h2>
        <dl>
          <div><dt>目前怎样回应你</dt><dd>本机模型服务已配置时直接请求当前模型；未连接时使用本地规则。模型请求失败只保留原话，不补造回复，也不自动重试。</dd></div>
          <div><dt>内容保存在哪里</dt><dd>聊天、草稿和每日画册保存在此浏览器，刷新后可恢复；没有跨设备同步，也未自动写入电脑文件夹。可在画册背面下载 .md。清除会删除本机保存的记录，已下载文件需自行管理。模型回答和用户原话分别标记。</dd></div>
          <div><dt>语音与生活数据</dt><dd>允许麦克风后，语音在浏览器内转成可修改的文字，不会自动发送；生活数据是模拟资料，尚未连接手机或手表。</dd></div>
          <div><dt>模型发送范围</dt><dd>每次仅发送本句前 800 字、同日最近最多两条已发送且仍有效的对话文字，以及上一条有效模型回复。首次回答还会附上本页展示的固定开场白，帮助理解你的回答。不会自动补发离线时期的记录、整本画册或设备数据。本机服务会将这些文字转给阿里云百炼／千问；服务方可能按其政策保存调用内容。</dd></div>
          <div><dt>每日画册整理</dt><dd>点击「整理今天」会将该日完整有效对话（包括档案中的用户修订）发送给当前模型，生成日记与暂定今日肖像。超过 30,000 字或 200 条时明确拒绝，不截断。翻面、编辑和下载不调用模型。普通聊天尚未自动读取每日档案或跨日记忆。</dd></div>
        </dl>
        <button type="button" className="product-details-close" onClick={closeDetails}>知道了</button>
      </dialog>
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
        <p className="guided-section-index">记录修改确认</p><h2 id="free-title-confirm-title">{pendingEntryChange.kind === 'deleteEntry' && !pendingEntryChange.affectedTitleDays.length ? '确认删除这条原话' : '确认撤下日页标题'}</h2>
        <p>{pendingEntryChange.kind === 'deleteEntry'
          ? '删除会同时撤下依赖它的模型回应、当天日记与今日肖像，避免已删除的内容留在摘要中。其他原话的档案修订会保留。已下载的文件需自行处理。'
          : '旧模型回应与今日肖像会撤下；你手写的日记保留，请核对内容是否需要更新。'}</p>
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
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (confirming) dialog.current?.showModal() }, [confirming])
  return <><FreeSession key={session} onReset={() => { setError(''); setConfirming(true) }} />
    {confirming && <dialog ref={dialog} className="free-print-dialog clear-records-dialog" onCancel={() => setConfirming(false)} aria-labelledby="clear-records-title">
      <h2 id="clear-records-title">清除本机记录？</h2><p>将清除聊天、草稿及每日画册。此操作无法撤回，建议先下载需要保留的 .md 文件。</p>
      {error && <p role="alert">{error}</p>}<div className="daily-actions"><button type="button" autoFocus onClick={() => setConfirming(false)}>保留记录</button><button type="button" onClick={() => {
        try { clearSavedSession(); setConfirming(false); setSession((value) => value + 1) }
        catch (cause) { setError(cause instanceof Error ? cause.message : '清除失败，记录仍保留。') }
      }}>确认清除本机记录</button></div>
    </dialog>}
  </>
}
