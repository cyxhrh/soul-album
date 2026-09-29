/** The only personal text that one bounded chat request may carry. */
export interface PrivateChatSource {
  kind: 'entry' | 'correction' | 'control'
  id: string
  revision: number
  /** Demonstration day, not a claim about the user's real-world calendar. */
  day: number
  quote: string
}

export interface PrivateChatRequest {
  turn: PrivateChatSource
  /** At most two previously recorded, still-current user-authored fragments. */
  context: PrivateChatSource[]
  /** The last still-valid generated response; never a transcript or full album. */
  precedingAssistant?: { reply: string; nextQuestion: string | null }
}

export interface PrivateChatResponse {
  status: 'generated'
  reply: string
  nextQuestion: string | null
  citations: Array<{ id: string; quote: string }>
  model: { provider: 'qwen'; id: string }
  generatedAt: string
}
