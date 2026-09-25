import * as v from 'valibot'
import {
  orchestrationProjectSchema,
  orchestrationProjectShellSchema,
  orchestrationWorktreeSchema,
  orchestrationWorktreeShellSchema,
  orchestrationSessionShellSchema,
  orchestrationSessionSchema,
  sessionRuntimeStateSchema,
  sessionDeletionStateSchema,
  orchestrationMessageSchema,
  orchestrationSessionActivitySchema,
} from '@workspace/contracts'
import type {
  ProjectionProjectRow,
  ProjectionWorktreeRow,
  ProjectionSessionRow,
  ProjectionSessionRuntimeRow,
  OrchestrationSessionMessageRow,
  OrchestrationSessionActivityRow,
} from '../../db/schema'

export function projectFromRow(row: ProjectionProjectRow) {
  return v.parse(orchestrationProjectSchema, {
    ...row,
    id: row.projectId,
    repositoryIdentity: parseJson(row.repositoryIdentityJson),
    defaultModelSelection: parseJson(row.defaultModelSelectionJson),
    scripts: parseJson(row.scriptsJson, []),
  })
}

export function projectShellFromRow(row: ProjectionProjectRow) {
  return v.parse(orchestrationProjectShellSchema, projectFromRow(row))
}

export function worktreeFromRow(row: ProjectionWorktreeRow) {
  return v.parse(orchestrationWorktreeSchema, {
    ...row,
    id: row.worktreeId,
    lifecycle: parseJson(row.lifecycleJson),
    worktreeCreationCapability: parseJson(row.creationCapabilityJson),
    cleanupEligibility: parseJson(row.cleanupEligibilityJson),
    pullRequest: parseJson(row.pullRequestJson),
    setup: parseJson(row.setupJson),
  })
}

export function worktreeShellFromRow(row: ProjectionWorktreeRow) {
  return v.parse(orchestrationWorktreeShellSchema, worktreeFromRow(row))
}

export function sessionShellFromRow(
  row: ProjectionSessionRow,
  runtime?: ProjectionSessionRuntimeRow,
) {
  return v.parse(orchestrationSessionShellSchema, {
    ...row,
    id: row.sessionId,
    modelSelection: parseJson(row.modelSelectionJson),
    titleState: parseJson(row.titleStateJson),
    titleRegeneration: parseJson(row.titleRegenerationJson),
    latestTurn: parseJson(row.latestTurnJson),
    planProgress: parseJson(row.planProgressJson),
    runtime: runtime ? runtimeFromRow(runtime) : null,
  })
}

export function sessionFromRow(
  row: ProjectionSessionRow,
  messages: readonly OrchestrationSessionMessageRow[],
  activities: readonly OrchestrationSessionActivityRow[],
  runtime?: ProjectionSessionRuntimeRow,
) {
  return v.parse(orchestrationSessionSchema, {
    ...sessionShellFromRow(row, runtime),
    deletedAt: row.deletedAt,
    deletion: deletionFromRow(row),
    messages: messages.map(messageFromRow),
    activities: activities.map(activityFromRow),
  })
}

export function messageFromRow(row: OrchestrationSessionMessageRow) {
  return v.parse(orchestrationMessageSchema, {
    ...row,
    id: row.messageId,
    attachments: parseJson(row.attachmentsJson, []),
  })
}

export function activityFromRow(row: OrchestrationSessionActivityRow) {
  return v.parse(orchestrationSessionActivitySchema, {
    ...row,
    id: row.activityId,
    payload: parseJson(row.payloadJson),
    sequence: row.sequence ?? undefined,
  })
}

function runtimeFromRow(row: ProjectionSessionRuntimeRow) {
  return v.parse(sessionRuntimeStateSchema, row)
}

function deletionFromRow(row: ProjectionSessionRow) {
  if (row.deletionSequence === null) return null
  return v.parse(sessionDeletionStateSchema, {
    deletionSequence: row.deletionSequence,
    providerStop: row.providerStopState,
    blobCleanup: row.blobCleanupState,
    providerStopError: row.providerStopError,
    blobCleanupError: row.blobCleanupError,
    updatedAt: row.deletionUpdatedAt,
  })
}

function parseJson(value: string | null, fallback: unknown = null): unknown {
  if (value === null) return fallback
  return JSON.parse(value)
}
