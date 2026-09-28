/** The unencrypted, device-local working state. Never send this snapshot to an API. */
export type InterpretationKind = 'answer' | 'proactive_record' | 'skip' | 'decline' | 'request_more' | 'uncertain'
export type InterpretationStatus = 'proposed' | 'accepted' | 'user_corrected'
export type Provenance = 'local_rule' | 'on_device_model' | 'cloud_model' | 'user_correction'

export interface Interpretation {
  kind: InterpretationKind
  status: InterpretationStatus
  provenance: Provenance
}

/** Entry-backed messages contain no second copy of the user's words. */
export interface StoredMessage {
  id: string
  clientOperationId: string
  sequence: number
  occurredAt: string
  recordedAt: string
  revision: number
  interpretation: Interpretation
  replyToQuestionId?: string | null
  invitationId?: string | null
  entryId: string | null
  controlEvent?: 'skip' | 'decline' | 'request_more' | null
  controlText: string | null
}

export interface JournalEntry {
  id: string
  messageId: string
  text: string
  journalDate: string
  timezone: string
  occurredAt: string
  recordedAt: string
  revision: number
  source: 'conversation'
}

export type CitationRef = { kind: 'entry' | 'observation'; id: string; revision: number }

export interface Question {
  id: string
  revision: number
  text: string
  provenance: 'local_rule' | 'on_device_model' | 'cloud_model'
  status: 'ready' | 'skipped' | 'citation_revised' | 'citation_deleted'
  displayedAt: string
  answeredByMessageId?: string | null
  skippedByMessageId?: string | null
  invitationId?: string | null
  citations: CitationRef[]
}

export interface Observation {
  id: string
  text: string
  status: 'tentative' | 'user_corrected'
  provenance: Provenance
  citations: Array<{ kind: 'entry'; id: string; revision: number }>
  revision: number
}

export interface DayTitle {
  text: string
  revision: number
  dependencyEntryIds: string[]
}

export type Cadence = 'daily' | 'weekly' | 'manual'

export interface Invitation {
  id: string
  date: string
  /** Frozen when scheduled; later cadence changes cannot alter this round. */
  questionTarget: 1 | 2
  state: 'scheduled' | 'delivered' | 'shown' | 'settled_answered' | 'settled_unanswered' | 'cancelled'
  revision: number
  shownAt?: string | null
  settledAt?: string | null
}

export interface CadenceChangeEvent {
  id: string
  reason: 'manual_choice' | 'two_shown_rounds_unanswered' | 'pause' | 'resume' | 'response_correction'
  previousCadence: Cadence
  nextCadence: Cadence
  decidedAt: string
  effectiveDate: string
  anchorDate: string
  triggeringInvitationIds: string[]
  retractedAt?: string | null
  /** Cancelled pending rounds can be counted again; effective rounds stay consumed. */
  retractionDisposition?: 'cancelled_pending' | 'annotated_effective'
}

export interface InvitationState {
  cadence: Cadence
  cadenceAnchorDate: string
  paused: boolean
  unansweredShownRounds: number
  pendingChange: CadenceChangeEvent | null
  changeEvents: CadenceChangeEvent[]
  invitations: Invitation[]
}

export type Source = 'watch_steps' | 'phone_spending' | 'app_usage' | 'photo' | 'calendar' | 'note' | 'office'
export type SourcePurpose = 'import_daily_summary' | 'use_in_journal'

export interface SourceGrant {
  id: string
  source: Source
  purpose: SourcePurpose
  scope: string[]
  status: 'active' | 'revoked' | 'provider_permission_missing'
  grantVersion: number
  approvedAt: string
  revokedAt?: string | null
  providerPermissionRef?: string | null
}

export interface DeletionTombstone {
  entityId: string
  entityKind: 'message' | 'entry' | 'observation' | 'source_fact' | 'source_summary'
  deletedAt: string
  spaceRevision: number
}

export interface SpaceSnapshot {
  id: string
  revision: number
  timezone: string
  /** The next sequence to issue, independent of currently retained messages. */
  nextMessageSequence: number
  messages: StoredMessage[]
  entries: JournalEntry[]
  questions: Question[]
  observations: Observation[]
  titles: Record<string, DayTitle>
  invitations: InvitationState
  sourceGrants: SourceGrant[]
  tombstones: DeletionTombstone[]
}
