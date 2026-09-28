import { grantSource, hasActiveSourceGrant, revokeSource } from './consents.js'
import { journalDate } from './date.js'
import { LocalDomainError } from './errors.js'
import {
  markInvitationShown, pauseInvitations, resumeInvitations,
  scheduleInvitation, setCadence, settleInvitation,
} from './invitations.js'
import { InMemorySpaceRepository } from './store.js'
import type { Cadence, InvitationState, Source, SourceGrant, SourcePurpose } from './types.js'

export interface ScheduleInvitationRequest {
  clientOperationId: string
  expectedSpaceRevision: number
  date: string
}

export interface InvitationEventRequest {
  clientOperationId: string
  invitationId: string
  event: 'shown' | 'settled_answered' | 'settled_unanswered'
  occurredAt: string
  expectedRevision: number
}

export interface SetCadenceRequest {
  clientOperationId: string
  expectedSpaceRevision: number
  requestedCadence: Cadence
  requestedAt: string
  timezone: string
}

export interface InvitationPauseRequest {
  clientOperationId: string
  expectedSpaceRevision: number
  requestedAt: string
  timezone: string
}

export interface GrantSourceRequest {
  clientOperationId: string
  source: Source
  purpose: SourcePurpose
  scope: string[]
  approvedAt: string
  providerPermissionRef?: string | null
}

export interface RevokeSourceRequest {
  clientOperationId: string
  grantId: string
  expectedGrantVersion: number
  revokedAt: string
}

function fingerprint(kind: string, ...fields: unknown[]): string {
  return JSON.stringify([kind, ...fields])
}

function requireTimezone(requested: string, stored: string): void {
  if (requested !== stored) throw new LocalDomainError('invalid_input')
}

export class LocalPreferencesService {
  constructor(private readonly repository: InMemorySpaceRepository) {}

  scheduleInvitation(spaceId: string, request: ScheduleInvitationRequest): InvitationState {
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId,
      fingerprint: fingerprint('scheduleInvitation', request.expectedSpaceRevision, request.date),
      expectedSpaceRevision: request.expectedSpaceRevision,
    }, (draft) => {
      const today = journalDate(this.repository.now(), draft.timezone)
      if (request.date < today) throw new LocalDomainError('revision_conflict')
      const next = scheduleInvitation(draft.invitations, this.repository.newId(), request.date)
      if (next === draft.invitations) throw new LocalDomainError('revision_conflict')
      draft.invitations = next
      return next
    })
  }

  markInvitationShown(spaceId: string, request: InvitationEventRequest): InvitationState {
    if (request.event !== 'shown') throw new LocalDomainError('invalid_input')
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId,
      fingerprint: fingerprint('markInvitationShown', request.invitationId, request.event,
        request.occurredAt, request.expectedRevision),
      expectedSpaceRevision: this.repository.read(spaceId).revision,
    }, (draft) => {
      const invitation = draft.invitations.invitations.find((item) => item.id === request.invitationId)
      if (!invitation) throw new LocalDomainError('not_found')
      if (invitation.revision !== request.expectedRevision ||
        journalDate(request.occurredAt, draft.timezone) !== invitation.date) {
        throw new LocalDomainError('revision_conflict')
      }
      const next = markInvitationShown(draft.invitations, invitation.id, request.occurredAt)
      if (next === draft.invitations) throw new LocalDomainError('revision_conflict')
      draft.invitations = next
      return next
    })
  }

  settleInvitation(spaceId: string, request: InvitationEventRequest): InvitationState {
    if (!['settled_answered', 'settled_unanswered'].includes(request.event)) {
      throw new LocalDomainError('invalid_input')
    }
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId,
      fingerprint: fingerprint('settleInvitation', request.invitationId, request.event,
        request.occurredAt, request.expectedRevision),
      expectedSpaceRevision: this.repository.read(spaceId).revision,
    }, (draft) => {
      const settledDate = journalDate(request.occurredAt, draft.timezone)
      const invitation = draft.invitations.invitations.find((item) => item.id === request.invitationId)
      if (!invitation) throw new LocalDomainError('not_found')
      if (invitation.revision !== request.expectedRevision) throw new LocalDomainError('revision_conflict')
      const roundQuestions = draft.questions.filter((question) => question.invitationId === invitation.id)
      const hasExplicitDecline = draft.messages.some((message) =>
        message.invitationId === invitation.id && message.controlEvent === 'decline' &&
        message.interpretation.kind === 'decline')
      const isPassiveOrPartial = request.event === 'settled_unanswered' ||
        roundQuestions.length < invitation.questionTarget
      if (!hasExplicitDecline && (roundQuestions.length === 0 ||
        (isPassiveOrPartial && (settledDate <= invitation.date ||
          journalDate(this.repository.now(), draft.timezone) <= invitation.date)))) {
        throw new LocalDomainError('revision_conflict')
      }
      const hasResponse = draft.messages.some((message) => message.invitationId === invitation.id &&
        message.entryId !== null && draft.entries.some((entry) => entry.id === message.entryId) &&
        (message.interpretation.kind === 'answer' ||
          message.interpretation.kind === 'proactive_record'))
      if ((request.event === 'settled_answered') !== hasResponse) {
        throw new LocalDomainError('revision_conflict')
      }
      const next = settleInvitation(draft.invitations, invitation.id,
        request.event === 'settled_answered', request.occurredAt, this.repository.newId())
      if (next === draft.invitations) throw new LocalDomainError('revision_conflict')
      for (const question of draft.questions) {
        if (question.invitationId === invitation.id && question.status === 'ready' &&
          !question.answeredByMessageId) {
          question.status = 'skipped'
          question.skippedByMessageId = null
          question.revision += 1
        }
      }
      draft.invitations = next
      return next
    })
  }

  setCadence(spaceId: string, request: SetCadenceRequest): InvitationState {
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId,
      fingerprint: fingerprint('setCadence', request.expectedSpaceRevision,
        request.requestedCadence, request.requestedAt, request.timezone),
      expectedSpaceRevision: request.expectedSpaceRevision,
    }, (draft) => {
      requireTimezone(request.timezone, draft.timezone)
      const today = journalDate(request.requestedAt, request.timezone)
      const next = setCadence(draft.invitations, request.requestedCadence,
        today, request.requestedAt, this.repository.newId())
      if (next === draft.invitations) throw new LocalDomainError('invalid_input')
      draft.invitations = next
      return next
    })
  }

  pauseInvitations(spaceId: string, request: InvitationPauseRequest): InvitationState {
    return this.changePauseState(spaceId, request, 'pause')
  }

  resumeInvitations(spaceId: string, request: InvitationPauseRequest): InvitationState {
    return this.changePauseState(spaceId, request, 'resume')
  }

  private changePauseState(
    spaceId: string, request: InvitationPauseRequest, kind: 'pause' | 'resume',
  ): InvitationState {
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId,
      fingerprint: fingerprint(kind, request.expectedSpaceRevision,
        request.requestedAt, request.timezone),
      expectedSpaceRevision: request.expectedSpaceRevision,
    }, (draft) => {
      requireTimezone(request.timezone, draft.timezone)
      const today = journalDate(request.requestedAt, request.timezone)
      const next = kind === 'pause'
        ? pauseInvitations(draft.invitations, today, request.requestedAt, this.repository.newId())
        : resumeInvitations(draft.invitations, today, request.requestedAt, this.repository.newId())
      if (next === draft.invitations) throw new LocalDomainError('invalid_input')
      draft.invitations = next
      return next
    })
  }

  grantSource(spaceId: string, request: GrantSourceRequest): SourceGrant {
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId,
      fingerprint: fingerprint('grantSource', request.source, request.purpose,
        request.scope, request.approvedAt, request.providerPermissionRef ?? null),
      expectedSpaceRevision: this.repository.read(spaceId).revision,
    }, (draft) => {
      journalDate(request.approvedAt, draft.timezone)
      const grant: SourceGrant = {
        id: this.repository.newId(), source: request.source, purpose: request.purpose,
        scope: [...request.scope], status: 'active', grantVersion: 1,
        approvedAt: request.approvedAt, providerPermissionRef: request.providerPermissionRef ?? null,
      }
      const next = grantSource(draft.sourceGrants, grant)
      if (next === draft.sourceGrants) throw new LocalDomainError('revision_conflict')
      draft.sourceGrants = next
      return grant
    })
  }

  revokeSource(spaceId: string, request: RevokeSourceRequest): SourceGrant {
    return this.repository.transact(spaceId, {
      clientOperationId: request.clientOperationId,
      fingerprint: fingerprint('revokeSource', request.grantId, request.expectedGrantVersion, request.revokedAt),
      expectedSpaceRevision: this.repository.read(spaceId).revision,
    }, (draft) => {
      journalDate(request.revokedAt, draft.timezone)
      const grant = draft.sourceGrants.find((item) => item.id === request.grantId)
      if (!grant) throw new LocalDomainError('not_found')
      if (grant.grantVersion !== request.expectedGrantVersion || grant.status === 'revoked') {
        throw new LocalDomainError('revision_conflict')
      }
      draft.sourceGrants = revokeSource(draft.sourceGrants, request.grantId, request.revokedAt)
      return draft.sourceGrants.find((item) => item.id === request.grantId)!
    })
  }

  /** App consent only; a connector must independently verify provider access. */
  hasActiveGrant(spaceId: string, source: Source, purpose: SourcePurpose, scope: string[]): boolean {
    return hasActiveSourceGrant(this.repository.read(spaceId).sourceGrants, source, purpose, scope)
  }
}
