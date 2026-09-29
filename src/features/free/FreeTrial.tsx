import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  cadenceForDay, changeCadence, createInvitationState, isInvitationDue,
  markInvitationShown, pauseInvitations, resumeInvitations, settleInvitation,
  shareProactively, type Cadence, type InvitationState,
} from '../../domain/invitations'
import { titleDaysAffectedByEntryChange, type Entry } from '../../domain/journal'
import { createBrowserLocalSession } from '../../domain/browserLocalSession'
import { classifyChatIntent } from '../../domain/chatIntent'
import { selectAlbum, selectAnsweredQuestions } from '../../domain/selectors'
import {
  privateAiAvailableOnThisHost, privateQuestionPreview, requestPrivateQuestion,
  validPrivateExcerpt, type PrivateQuestionPreview,
} from './privateQuestion'
import {
  currentChatTurns, excerptFromText, privateChatAvailableOnThisHost, PrivateChatRequestError, requestPrivateChat,
  sourceForMessage, sourceIsCurrent, validChatExcerpt, validChatRequest,
  type PrivateChatRequest, type PrivateChatSource, type PrivateChatTurn,
} from './privateChat'
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
type ChatMode = 'local' | 'qwen'
type ControlExchange = { id: string; reply: string; promptQuestionId?: string }
type TimelineItem = { kind: 'entry'; order: number; messageId: string; entry: Entry } |
  { kind: 'control'; order: number; messageId: string; exchange?: ControlExchange; text: string }

function chatFailureCopy(error: unknown): string {
  const prefix = '这句仍保存在本页画册，没有自动重试。'
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

interface ChatPreview {
  messageId: string
  turn: PrivateChatSource
  candidates: PrivateChatSource[]
  preceding?: PrivateChatTurn
}

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
  const [chatMode, setChatMode] = useState<ChatMode>('local')
  const [chatTurns, setChatTurns] = useState<PrivateChatTurn[]>([])
  const [chatPreview, setChatPreview] = useState<ChatPreview | null>(null)
  const [chatQuote, setChatQuote] = useState('')
  const [chatContextIds, setChatContextIds] = useState<string[]>([])
  const [chatIncludePreceding, setChatIncludePreceding] = useState(true)
  const [chatRequestPending, setChatRequestPending] = useState(false)
  const [chatError, setChatError] = useState('')
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
  const [privatePreview, setPrivatePreview] = useState<PrivateQuestionPreview | null>(null)
  const [privateQuote, setPrivateQuote] = useState('')
  const [privatePending, setPrivatePending] = useState(false)
  const [privateError, setPrivateError] = useState('')
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
  const privateDialogRef = useRef<HTMLDialogElement>(null)
  const privateOpenerRef = useRef<HTMLElement | null>(null)
  const privateControllerRef = useRef<AbortController | null>(null)
  const chatDialogRef = useRef<HTMLDialogElement>(null)
  const chatOpenerRef = useRef<HTMLElement | null>(null)
  const chatControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    privateControllerRef.current?.abort()
    chatControllerRef.current?.abort()
  }, [])

  useLayoutEffect(() => {
    if (!chatPreview) {
      if (chatOpenerRef.current?.isConnected) chatOpenerRef.current.focus()
      chatOpenerRef.current = null
      return
    }
    const dialog = chatDialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    dialog.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
    return () => { if (dialog.open) dialog.close() }
  }, [chatPreview])

  useLayoutEffect(() => {
    if (!privatePreview) {
      if (privateOpenerRef.current?.isConnected) privateOpenerRef.current.focus()
      privateOpenerRef.current = null
      return
    }
    const dialog = privateDialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    dialog.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
    return () => { if (dialog.open) dialog.close() }
  }, [privatePreview])

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
  const privateCandidate = privateAiAvailableOnThisHost(window.location.hostname)
    ? privateQuestionPreview(snapshot, activeQuestion) : null
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
  const todayCorrections = journal.observations.filter((observation) =>
    observation.day === day && observation.status === 'corrected')
  const recordedDays = [...new Set([
    ...journal.entries.map((entry) => entry.day),
    ...journal.observations.filter((observation) => observation.status === 'corrected')
      .map((observation) => observation.day),
  ])]
    .sort((first, second) => first - second)
  const albumDay = recordedDays.includes(viewedDay) ? viewedDay : recordedDays.at(-1) ?? day
  const album = selectAlbum(journal, albumDay)
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
  const todayQuestions = selectAnsweredQuestions(journal, day)
  const entryById = new Map(journal.entries.map((entry) => [entry.id, entry]))
  const controlsById = new Map(controlExchanges.map((exchange) => [exchange.id, exchange]))
  const visibleChatTurns = currentChatTurns(snapshot, chatTurns)
  const chatTurnByMessageId = new Map(visibleChatTurns.map((turn) => [turn.messageId, turn]))
  const chatRequest: PrivateChatRequest | null = chatPreview ? {
    turn: { ...chatPreview.turn, quote: chatQuote },
    context: chatPreview.candidates.filter((source) => chatContextIds.includes(source.id)),
    ...(chatIncludePreceding && chatPreview.preceding ? { precedingAssistant: {
      reply: chatPreview.preceding.response.reply,
      nextQuestion: chatPreview.preceding.response.nextQuestion,
    } } : {}),
  } : null
  const chatTurnOriginal = chatPreview?.turn.kind === 'entry'
    ? snapshot.entries.find((entry) => entry.id === chatPreview.turn.id)?.text ?? ''
    : chatPreview?.turn.kind === 'control'
      ? snapshot.messages.find((message) => message.id === chatPreview.turn.id)?.controlText ?? '' : ''
  const todayTimeline: TimelineItem[] = session.projectMessages(snapshot)
    .filter((message) => session.dayForTimestamp(message.occurredAt) === day)
    .flatMap((message): TimelineItem[] => {
      if (message.entryId) {
        const entry = entryById.get(message.entryId)
        return entry ? [{ kind: 'entry' as const, order: message.sequence, messageId: message.id, entry }] : []
      }
      const exchange = controlsById.get(message.id)
      return [{ kind: 'control' as const, order: message.sequence,
        messageId: message.id, exchange, text: message.text }]
    })

  useLayoutEffect(() => {
    if (activeTab !== 'chat' || !chatScrollRef.current) return
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [activeTab, day, journal.entries.length, controlExchanges.length, questionIndex, extraQuestion,
    chatTurns.length, chatMode, chatPreview])

  useEffect(() => {
    setChatTurns((current) => {
      const valid = currentChatTurns(snapshot, current)
      return valid.length === current.length ? current : valid
    })
  }, [snapshot])

  function refresh() {
    setSnapshot(session.read())
  }

  function openPrivateQuestionGate() {
    const candidate = privateQuestionPreview(session.read(),
      session.read().questions.find((question) => question.id === activeQuestionId))
    if (!candidate || !privateAiAvailableOnThisHost(window.location.hostname)) {
      setStatus('这条问题的来源已变化，继续使用本地规则问题。')
      refresh()
      return
    }
    privateOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPrivateQuote(candidate.quote)
    setPrivateError('')
    setPrivatePreview(candidate)
  }

  function closePrivateQuestionGate() {
    privateControllerRef.current?.abort()
    privateControllerRef.current = null
    setPrivatePending(false)
    setPrivatePreview(null)
    setPrivateQuote('')
    setPrivateError('')
  }

  async function confirmPrivateQuestion() {
    const preview = privatePreview
    if (!preview || privatePending) return
    if (!validPrivateExcerpt(preview.original, privateQuote)) {
      setPrivateError('只能发送当前原话中连续、逐字一致的片段；如需改写，请先修改画册原话。')
      return
    }
    const latest = session.read()
    const currentQuestion = latest.questions.find((question) => question.id === preview.questionId)
    const currentEntry = latest.entries.find((entry) => entry.id === preview.entryCitation.id)
    if (latest.revision !== preview.expectedSpaceRevision ||
      currentQuestion?.revision !== preview.expectedQuestionRevision ||
      currentQuestion.status !== 'ready' || currentQuestion.id !== activeQuestionId ||
      currentEntry?.revision !== preview.entryCitation.revision ||
      !currentEntry.text.includes(privateQuote)) {
      closePrivateQuestionGate()
      refresh()
      setStatus('原话或问题已变化，本次许可失效；规则问题仍在。')
      return
    }
    const controller = new AbortController()
    privateControllerRef.current = controller
    setPrivatePending(true)
    setPrivateError('')
    try {
      const proposal = await requestPrivateQuestion(preview, privateQuote, controller.signal)
      if (controller.signal.aborted) return
      session.adoptCloudQuestion({
        expectedSpaceRevision: preview.expectedSpaceRevision,
        questionId: preview.questionId,
        expectedQuestionRevision: preview.expectedQuestionRevision,
        entryCitation: preview.entryCitation,
        entryQuote: privateQuote,
        text: proposal.question,
      })
      refresh()
      closePrivateQuestionGate()
      setStatus('千问提议了下一问，已保留关联原话；若理解偏了，可以纠正。')
    } catch {
      if (controller.signal.aborted) return
      closePrivateQuestionGate()
      setStatus('这次模型提问未完成，规则问题仍在；没有自动重试。')
    } finally {
      if (privateControllerRef.current === controller) privateControllerRef.current = null
      setPrivatePending(false)
    }
  }

  function closeChatGate() {
    chatControllerRef.current?.abort()
    chatControllerRef.current = null
    setChatRequestPending(false)
    setChatPreview(null)
    setChatQuote('')
    setChatContextIds([])
    setChatError('')
  }

  function openChatGate(messageId: string) {
    const latest = session.read()
    const messages = session.projectMessages(latest)
    const message = messages.find((item) => item.id === messageId)
    if (!message || !privateChatAvailableOnThisHost(window.location.hostname)) {
      setStatus('本次内容已保存在本页；当前地址无法连接私人千问聊天。')
      return
    }
    const source = sourceForMessage(latest, message, session.dayForTimestamp(message.occurredAt))
    if (!source || !sourceIsCurrent(latest, source)) {
      setStatus('这条原话已变化，暂时只保留本地记录。')
      return
    }
    const previous = messages.filter((item) => item.sequence < message.sequence).reverse()
      .map((item) => sourceForMessage(latest, item, session.dayForTimestamp(item.occurredAt)))
      .filter((item): item is PrivateChatSource => !!item && sourceIsCurrent(latest, item))
    const corrections: PrivateChatSource[] = [...latest.observations].reverse()
      .filter((item) => item.status === 'user_corrected')
      .map((item) => ({
        kind: 'correction' as const, id: item.id, revision: item.revision,
        day: session.dayForDate(item.journalDate ?? session.dateForDay(day)),
        quote: excerptFromText(item.text),
      }))
      .filter((item) => sourceIsCurrent(latest, item))
    const candidates = [...corrections, ...previous]
      .filter((item, index, all) => item.id !== source.id && all.findIndex((other) => other.id === item.id) === index)
      .slice(0, 2)
    const preceding = currentChatTurns(latest, chatTurns).at(-1)
    chatOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setChatPreview({ messageId, turn: source, candidates, preceding })
    setChatQuote(source.quote)
    setChatContextIds(candidates.map((item) => item.id))
    setChatIncludePreceding(true)
    setChatError('')
    setStatus('已保存在本页；查看本次内容后，才会发送给千问。')
  }

  async function confirmChat() {
    const preview = chatPreview
    const request = chatRequest
    if (!preview || !request || chatRequestPending) return
    const latest = session.read()
    const preceding = preview.preceding && currentChatTurns(latest, chatTurns)
      .find((turn) => turn.messageId === preview.preceding?.messageId)
    const original = preview.turn.kind === 'entry'
      ? latest.entries.find((item) => item.id === preview.turn.id)?.text ?? ''
      : latest.messages.find((item) => item.id === preview.turn.id)?.controlText ?? ''
    if (!validChatExcerpt(original, chatQuote) ||
      !validChatRequest(request) ||
      ![request.turn, ...request.context].every((source) => sourceIsCurrent(latest, source)) ||
      !latest.messages.some((message) => message.id === preview.messageId) ||
      (request.precedingAssistant && !preceding)) {
      setChatError('原话或上下文已变化，请仅保留本地内容，重新发送新消息。')
      return
    }
    const controller = new AbortController()
    chatControllerRef.current = controller
    setChatRequestPending(true)
    setChatError('')
    try {
      const response = await requestPrivateChat(request, controller.signal)
      if (controller.signal.aborted || chatControllerRef.current !== controller) return
      const current = session.read()
      if (![request.turn, ...request.context].every((source) => sourceIsCurrent(current, source)) ||
        !current.messages.some((message) => message.id === preview.messageId) ||
        (request.precedingAssistant && !currentChatTurns(current, chatTurns)
          .some((turn) => turn.messageId === preceding?.messageId))) {
        closeChatGate()
        setStatus('发送后记录或上下文发生了变化；这次模型结果已撤下。')
        return
      }
      const turn: PrivateChatTurn = {
        messageId: preview.messageId, request, response,
        ...(request.precedingAssistant && preceding ? { precedingMessageId: preceding.messageId } : {}),
      }
      setChatTurns((existing) => [...currentChatTurns(current, existing), turn])
      closeChatGate()
      setStatus('千问已回复。下一句仍由你决定是否单次发送，模型回应不会写成画册事实。')
    } catch (error) {
      if (controller.signal.aborted) return
      closeChatGate()
      setStatus(chatFailureCopy(error))
    } finally {
      if (chatControllerRef.current === controller) {
        chatControllerRef.current = null
        setChatRequestPending(false)
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

  function advanceDay(target: number) {
    if (target <= day) return
    closeChatGate()
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
    const promptId = chatMode === 'local' && (due || extraQuestion) ? activeQuestionId : null
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
    if (chatMode === 'qwen') {
      if (result.entry) {
        setInvitation(shareProactively(invitation))
        setAnsweredInRound(true)
      }
      openChatGate(result.message.id)
      return
    }
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
      closeChatGate()
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
            <span>{chatMode === 'qwen' ? '千问聊天 · 每次确认' : activeQuestionMode} · 记录仅留本次页面</span>
            <button type="button" onClick={onReset} aria-label="清除本次内容">清除</button>
          </div>
        </header>
        {status && <p ref={statusRef} className="free-status product-status screen-only" role="status" tabIndex={-1}>{status}</p>}
        <div className="product-content">
          <section className="product-chat screen-only" aria-label="对话记录" hidden={activeTab !== 'chat'}>
            {privateChatAvailableOnThisHost(window.location.hostname) && <div className="product-chat-modes" role="group" aria-label="对话方式">
              <button type="button" aria-pressed={chatMode === 'qwen'} onClick={() => {
                if (chatMode === 'qwen') return
                closeChatGate(); setChatMode('qwen'); setStatus('已进入千问聊天。每句话先留在本页；预览并确认后才会发送给模型。')
              }}>千问聊天</button>
              <button type="button" aria-pressed={chatMode === 'local'} onClick={() => {
                if (chatMode === 'local') return
                closeChatGate(); setChatMode('local'); setStatus('已切回本地规则体验，不会自动发送给模型。')
              }}>本地规则</button>
              <span>{chatMode === 'qwen' ? '每次发送单独授权 · 可连续聊天' : '默认纯本地 · 不使用模型'}</span>
            </div>}
            <div className="product-chat-scroll" ref={chatScrollRef}>
              <p className="product-day-divider"><span>第 {day} 天</span></p>
              <div className="product-thread">
                {todayTimeline.map((item) => {
                  if (item.kind === 'control') return <div className="product-exchange" key={item.messageId}>
                    {item.exchange?.promptQuestionId && <div className="product-bubble-row agent">
                      <span className="product-avatar" aria-hidden="true">画</span>
                      <div className="product-bubble"><small>心灵画册 · 当时的问题</small>
                        <p>{snapshot.questions.find((question) => question.id === item.exchange?.promptQuestionId)?.text ?? '旧提问已撤下。'}</p></div>
                    </div>}
                    <div className="product-bubble-row user"><div className="product-bubble"><p>{item.text}</p></div></div>
                    {item.exchange?.reply && <div className="product-bubble-row agent"><span className="product-avatar" aria-hidden="true">画</span>
                      <div className="product-bubble"><p>{item.exchange.reply}</p></div></div>}
                    {chatTurnByMessageId.get(item.messageId) && <div className="product-bubble-row agent">
                      <span className="product-avatar" aria-hidden="true">画</span>
                      <div className="product-bubble product-ai-reply"><small>千问 · 本次授权生成</small>
                        <p>{chatTurnByMessageId.get(item.messageId)!.response.reply}</p>
                        {chatTurnByMessageId.get(item.messageId)!.response.nextQuestion &&
                          <p className="product-ai-followup">{chatTurnByMessageId.get(item.messageId)!.response.nextQuestion}</p>}
                        <details className="product-question-evidence"><summary>查看当时发送的内容</summary>
                          <pre>{JSON.stringify(chatTurnByMessageId.get(item.messageId)!.request, null, 2)}</pre></details>
                      </div></div>}
                  </div>
                  const entry = item.entry
                  const answered = todayQuestions.find((questionRecord) => questionRecord.answerEntryId === entry.id)
                  const answeredSourcePreview = answered?.status === 'ready'
                    ? entrySourcePreview(answered.citationEntryId, answered.citationEntryRevision) : null
                  const isProactive = entry.topicId.startsWith('proactive-day-')
                  return <div className="product-exchange" key={entry.id}>
                    {answered && !isProactive && <div className="product-bubble-row agent">
                      <span className="product-avatar" aria-hidden="true">画</span>
                      <div className="product-bubble"><small>心灵画册 · {answered.mode === 'cloud' ? '千问提议的问题' : '当时的规则问题'}</small>
                        <p>{answered.status === 'ready' ? answered.text :
                          answered.status === 'reference-deleted' ? '这题引用的原话已删除。' : '这题引用的原话已有修订。'}</p>
                        {answeredSourcePreview && <small className="product-question-source">{answeredSourcePreview}</small>}
                        {answered.mode === 'cloud' && answered.status === 'ready' && answered.approvedExcerpt &&
                          <details className="product-question-evidence"><summary>查看当时发送给千问的片段</summary>
                            <blockquote>“{answered.approvedExcerpt}”</blockquote></details>}</div>
                    </div>}
                    <div className="product-bubble-row user"><div className="product-bubble">
                      <p>{entry.text}</p>
                      <time dateTime={entry.recordedAt}>{entry.recordedAt.slice(11, 16)}{entry.revision > 1 && ' · 已修订'}</time>
                    </div></div>
                    {chatTurnByMessageId.get(item.messageId) && <div className="product-bubble-row agent">
                      <span className="product-avatar" aria-hidden="true">画</span>
                      <div className="product-bubble product-ai-reply"><small>千问 · 本次授权生成</small>
                        <p>{chatTurnByMessageId.get(item.messageId)!.response.reply}</p>
                        {chatTurnByMessageId.get(item.messageId)!.response.nextQuestion &&
                          <p className="product-ai-followup">{chatTurnByMessageId.get(item.messageId)!.response.nextQuestion}</p>}
                        <details className="product-question-evidence"><summary>查看当时发送的内容</summary>
                          <pre>{JSON.stringify(chatTurnByMessageId.get(item.messageId)!.request, null, 2)}</pre></details>
                      </div></div>}
                  </div>
                })}
                {todayCorrections.map((correction) => <div className="product-bubble-row user"
                  aria-label="你补充的纠正" key={correction.id}>
                  <div className="product-bubble"><small>你补充的准确背景 · 仅留本页</small><p>{correction.text}</p></div>
                </div>)}
                {chatMode === 'local' && (due || extraQuestion) && <div className="product-bubble-row agent current">
                  <span className="product-avatar" aria-hidden="true">画</span>
                  <div className="product-bubble"><small>第 {day} 天 · {extraQuestion ? '主动第 3 题' : '第 ' + (questionIndex + 1) + ' 题'} · {activeQuestionMode}</small>
                    <p>{visibleQuestionText}</p>
                    {activeSourcePreview && <small className="product-question-source">{activeSourcePreview}</small>}
                    {activeQuestion?.provenance === 'cloud_model' && activeQuestion.approvedExcerpt &&
                      <details className="product-question-evidence"><summary>查看这次发送给千问的片段</summary>
                        <blockquote>“{activeQuestion.approvedExcerpt}”</blockquote></details>}
                    {privateCandidate && <button type="button" className="product-question-action" onClick={openPrivateQuestionGate}>
                      让千问提议这一问</button>}
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
                {chatMode === 'local' && !due && !extraQuestion && <div className="product-rest" role="note">
                  <strong>{roundClosed ? '今天的邀请已结束' : '第 ' + day + ' 天不邀请'}</strong>
                  <p>{roundClosed ? '今天可以停在这里，也可以自己再记一句。' :
                    '未展示的日期不会补发问题；想记事时仍可直接留言。'}</p>
                  {!roundClosed && cadence === 'weekly' && nextDay !== null && <p className="product-next-hint">下次邀请在第 {nextDay} 天</p>}
                </div>}
                {chatMode === 'qwen' && todayTimeline.length === 0 && <div className="product-rest" role="note">
                  <strong>想说什么，直接写在下面</strong>
                  <p>先保存在本页，再由你决定这次是否发给千问。它可以回应你，也可以选择不追问。</p>
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
                  <button type="button" className="product-send" onClick={sendMessage}
                    disabled={!draft.trim() || !!chatPreview || chatRequestPending}>发送</button>
                </div>
                <p className="product-composer-note">{chatMode === 'qwen'
                  ? '发送先记入本页画册；确认本次内容后才请千问回复。下一句仍可直接在这里说。'
                  : '演示版会将一般消息记入画册；可随时修改或删除。'}</p>
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
              {recordedDays.map((target) => {
                const dayAlbum = selectAlbum(journal, target)
                const correctionCount = dayAlbum?.observations.filter((item) => item.status === 'corrected').length ?? 0
                return <button type="button" key={target}
                  aria-label={'查看第 ' + target + ' 天'} aria-current={albumDay === target ? 'date' : undefined}
                  onClick={() => viewRecordedDay(target)}>第 {target} 天<small>{dayAlbum?.entries.length} 条原话
                    {correctionCount > 0 && ` · ${correctionCount} 条纠正`}</small></button>
              })}
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
            </section>}
            {album && <section className="free-question-history product-question-history screen-only"
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
            </section>}
          </section>

          <section className="product-data screen-only" aria-label="生活数据" hidden={activeTab !== 'data'}>
            <DataInsights consents={consents} onToggle={toggleConsent} />
          </section>
        </div>
        <footer className="product-footer screen-only">
          <p>本地规则默认开启；本机可选连续千问聊天。仅在逐次查看并确认后，所选片段才会离开页面；模拟数据不读取真实设备，也没有账号或长期保存。</p>
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
      {privatePreview && <dialog ref={privateDialogRef} className="free-print-dialog product-private-dialog screen-only"
        role="dialog" aria-modal="true" aria-labelledby="private-question-title"
        onCancel={(event) => { event.preventDefault(); closePrivateQuestionGate() }}>
        <p className="guided-section-index">单次隐私授权</p><h2 id="private-question-title">让千问提议这一问</h2>
        <p>这一次只把下方片段、来源标识与修订版本送到本机服务；本机向阿里云百炼／千问转发片段和来源标识，不转发修订版本。内容会离开本次页面；服务方可能按其政策存储调用数据。其他画册记录、设备资料不会随这次请求发送。</p>
        <label htmlFor="private-question-quote">实际发送的原话片段（可删减为原话中连续的一段）</label>
        <textarea id="private-question-quote" value={privateQuote} maxLength={800} rows={5}
          disabled={privatePending} onChange={(event) => { setPrivateQuote(event.target.value); setPrivateError('') }} />
        <details><summary>查看完整请求内容</summary><pre>{JSON.stringify({ entry: {
          id: privatePreview.entryCitation.id, revision: privatePreview.entryCitation.revision, quote: privateQuote,
        } }, null, 2)}</pre></details>
        <p>同意仅用于眼前这一问，不会开启自动发送。取消后继续使用当前规则问题。</p>
        {privateError && <p role="alert">{privateError}</p>}
        {privatePending && <p role="status">请求已发出。取消只放弃采纳结果；已发送内容无法撤回，也可能产生调用费用。</p>}
        <div className="free-print-actions">
          <button type="button" autoFocus onClick={closePrivateQuestionGate}>仅保留本地问题</button>
          <button type="button" disabled={privatePending || !validPrivateExcerpt(privatePreview.original, privateQuote)}
            onClick={() => void confirmPrivateQuestion()}>同意并发送这一次</button>
        </div>
      </dialog>}
      {chatPreview && <dialog ref={chatDialogRef} className="free-print-dialog product-private-dialog product-chat-dialog screen-only"
        role="dialog" aria-modal="true" aria-labelledby="private-chat-title"
        onCancel={(event) => { event.preventDefault(); closeChatGate() }}>
        <p className="guided-section-index">千问聊天 · 单次隐私授权</p><h2 id="private-chat-title">查看这一次发给千问的内容</h2>
        <p>消息已保存在本页。只有本次确认后，所选片段才经本机发给阿里云百炼／千问；服务方可能存储调用数据。取消只保留本地，下次不会自动发送。</p>
        <label htmlFor="private-chat-quote">这句发给千问的片段（可缩短为原话中连续的一段）</label>
        <textarea id="private-chat-quote" value={chatQuote} rows={2} maxLength={800}
          disabled={chatRequestPending} onChange={(event) => { setChatQuote(event.target.value); setChatError('') }} />
        {chatPreview.candidates.length > 0 && <fieldset className="product-chat-context">
          <legend>可选历史上下文 · 最多两条</legend>
          {chatPreview.candidates.map((source) => <label key={source.id}>
            <input type="checkbox" checked={chatContextIds.includes(source.id)} disabled={chatRequestPending}
              onChange={(event) => setChatContextIds((current) => event.target.checked
                ? [...current, source.id] : current.filter((id) => id !== source.id))} />
            <span>第 {source.day} 天 · {source.kind === 'correction' ? '你纠正的背景' : '你的原话'}：{source.quote}</span>
          </label>)}
        </fieldset>}
        {chatPreview.preceding && <label className="product-chat-preceding">
          <input type="checkbox" checked={chatIncludePreceding} disabled={chatRequestPending}
            onChange={(event) => setChatIncludePreceding(event.target.checked)} />
          <span>带上上一条有效的千问回复与追问：{chatPreview.preceding.response.reply}
            {chatPreview.preceding.response.nextQuestion && ` / ${chatPreview.preceding.response.nextQuestion}`}</span>
        </label>}
        <p>本机只发送下方 JSON 中的本句、勾选的上下文与上次回复；不会发送整本画册、设备数据或未勾选的记录。</p>
        <strong className="product-chat-payload-heading">本次实际请求</strong>
        <pre className="product-chat-payload">{JSON.stringify(chatRequest, null, 2)}</pre>
        {chatError && <p role="alert">{chatError}</p>}
        {chatRequestPending && <p role="status">正在等待千问回复。取消会放弃结果并尝试中止请求；已经发送的内容无法撤回，也可能产生费用。</p>}
        <div className="free-print-actions">
          <button type="button" autoFocus onClick={() => { closeChatGate(); setStatus('这句仅保存在本页，没有发送给千问。') }}>仅保留本地</button>
          <button type="button" disabled={chatRequestPending || !chatRequest ||
            !validChatExcerpt(chatTurnOriginal, chatQuote) || !validChatRequest(chatRequest)}
          onClick={() => void confirmChat()}>同意并发送这一次</button>
        </div>
      </dialog>}
    </main>
  )
}

export default function FreeTrial() {
  const [session, setSession] = useState(0)
  return <FreeSession key={session} onReset={() => setSession((value) => value + 1)} />
}
