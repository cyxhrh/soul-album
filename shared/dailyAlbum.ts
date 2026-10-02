export interface DailyMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  recordedAt: string
  revised?: boolean
}

export interface DailyAlbumRequest {
  date: string
  messages: DailyMessage[]
}

export interface DailyAlbumContent {
  title: string
  diary: string
  portrait: {
    facts: string[]
    feelings: string[]
    observations: { text: string; evidenceIds: string[] }[]
    uncertainties: string[]
  }
}

export interface DailyAlbumResponse extends DailyAlbumContent {
  status: 'generated'
  model: { provider: string; id: string }
  generatedAt: string
}

export const MAX_DAILY_MESSAGES = 200
export const MAX_DAILY_TEXT_CHARS = 30_000
