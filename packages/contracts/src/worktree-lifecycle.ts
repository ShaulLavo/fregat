import * as v from 'valibot'
import {
  commandIdSchema,
  projectIdSchema,
  sessionIdSchema,
  turnIdSchema,
  worktreeIdSchema,
} from './chat-ids'

const text = v.pipe(v.string(), v.minLength(1))
const count = v.pipe(v.number(), v.integer(), v.minValue(0))
const operation = { operationId: commandIdSchema }
const target = { commandId: commandIdSchema, worktreeId: worktreeIdSchema }

export const sessionWorktreeTargetSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('current'), worktreeId: worktreeIdSchema }),
  v.strictObject({
    kind: v.literal('new'),
    worktreeId: worktreeIdSchema,
    baseWorktreeId: worktreeIdSchema,
    /** A local branch to start from; absent means the base worktree's HEAD. */
    baseBranch: v.optional(text),
  }),
])

export const worktreeCleanupAuthorizationSchema = v.strictObject({
  expectedHead: text,
  expectedStatusFingerprint: text,
})
export const worktreeMissingAuthorizationSchema = v.strictObject({
  canonicalPath: text,
  registrationGeneration: count,
  pathAbsent: v.literal(true),
  adminAbsent: v.literal(true),
})
export const worktreeCleanupModeSchema = v.picklist(['safe', 'discard-changes'])
export const worktreeCleanupBlockerSchema = v.variant('reason', [
  v.object({ reason: v.literal('dirty'), changedFileCount: count }),
  v.object({ reason: v.literal('needs-reconfirmation'), changedFileCount: v.null() }),
  v.object({ reason: v.literal('active-runtime'), changedFileCount: v.null() }),
  v.object({ reason: v.literal('active-terminal'), changedFileCount: v.null() }),
])
export const worktreeLifecycleSchema = v.variant('state', [
  v.object({ state: v.literal('provisioning'), ...operation, baseCommit: text, branch: text }),
  v.object({ state: v.literal('ready') }),
  v.object({ state: v.literal('creation-failed'), ...operation, errorCode: text }),
  v.object({
    state: v.literal('orphaned'),
    reason: v.picklist(['unprojected-managed-path', 'stale-git-admin']),
    pathKind: v.picklist(['id-derived', 'legacy']),
  }),
  v.object({ state: v.literal('missing') }),
  v.object({ state: v.literal('retired'), retiredAt: text }),
  v.variant('mode', [
    v.object({ state: v.literal('cleanup-requested'), ...operation, mode: v.literal('safe') }),
    v.object({
      state: v.literal('cleanup-requested'),
      ...operation,
      mode: v.literal('discard-changes'),
      ...worktreeCleanupAuthorizationSchema.entries,
    }),
  ]),
  v.variant(
    'reason',
    worktreeCleanupBlockerSchema.options.map((schema) =>
      v.object({ state: v.literal('cleanup-blocked'), ...operation, ...schema.entries }),
    ),
  ),
  v.object({ state: v.literal('cleanup-failed'), ...operation, errorCode: text }),
  v.object({ state: v.literal('removed'), ...operation, removedAt: text }),
])

export const worktreeCreationCapabilitySchema = v.variant('allowed', [
  v.object({ allowed: v.literal(true) }),
  v.object({
    allowed: v.literal(false),
    reason: v.picklist(['not-git', 'base-not-ready', 'wrong-project']),
  }),
])
export const worktreeCleanupEligibilitySchema = v.object({
  reason: v.picklist([
    'eligible',
    'referenced',
    'provider-stop-pending',
    'provider-stop-failed',
    'active-runtime',
    'active-terminal',
    'terminal-ownership-unknown',
    'external-driver-unverified',
    'protected',
    'external',
    'unclaimed',
    'missing',
    'not-ready',
  ]),
  nonDeletedSessionCount: count,
  canResolveMissing: v.boolean(),
})

/**
 * The pull request for a dedicated worktree's branch, as the forge last answered. `unknown` is a
 * failed lookup with nothing known before it; it never stands for "no pull request".
 */
export const worktreePullRequestSchema = v.variant('status', [
  v.object({ status: v.literal('none') }),
  v.object({ status: v.literal('unknown') }),
  v.object({
    status: v.literal('unsupported'),
    support: v.picklist(['cli-missing', 'unauthenticated', 'no-forge']),
  }),
  v.object({
    status: v.literal('found'),
    number: v.pipe(v.number(), v.integer(), v.minValue(1)),
    title: v.string(),
    url: text,
    state: v.picklist(['open', 'closed', 'merged']),
    draft: v.boolean(),
    /** When it was merged or closed; settlement compares it with the session's last request. */
    closedAt: v.optional(v.nullable(v.string()), null),
  }),
])

export const worktreeLifecycleEntries = {
  lifecycle: worktreeLifecycleSchema,
  operationId: v.nullable(commandIdSchema),
  baseWorktreeId: v.nullable(worktreeIdSchema),
  baseCommit: v.nullable(text),
  headCommit: v.nullable(text),
  metadataVersion: count,
  pathKind: v.picklist(['id-derived', 'legacy']),
  activeTerminalCount: count,
  terminalOwnershipUnknown: v.boolean(),
  externalDriverUnverified: v.boolean(),
  removedAt: v.nullable(text),
  worktreeCreationCapability: worktreeCreationCapabilitySchema,
  cleanupEligibility: worktreeCleanupEligibilitySchema,
} as const

export const worktreeProvisioningSchema = v.object({
  worktreeId: worktreeIdSchema,
  baseWorktreeId: worktreeIdSchema,
  projectId: projectIdSchema,
  baseCommit: text,
  branch: text,
  path: v.string(),
  canonicalPath: text,
})
export const worktreeCleanupPreviewSchema = v.object({
  worktreeId: worktreeIdSchema,
  authorization: worktreeCleanupAuthorizationSchema,
  changedFileCount: count,
})
export const worktreeMissingPreviewSchema = v.object({
  worktreeId: worktreeIdSchema,
  authorization: worktreeMissingAuthorizationSchema,
})

export const worktreeRetryCommandSchema = v.strictObject({
  ...target,
  type: v.literal('worktree.retry'),
})
export const worktreeCleanupCommandSchema = v.strictObject({
  ...target,
  type: v.literal('worktree.cleanup'),
})
export const worktreeForceCleanupCommandSchema = v.strictObject({
  ...target,
  type: v.literal('worktree.force-cleanup'),
  authorization: worktreeCleanupAuthorizationSchema,
})
export const worktreeRetainCommandSchema = v.strictObject({
  ...target,
  type: v.literal('worktree.retain'),
})
export const worktreeAdoptCommandSchema = v.strictObject({
  ...target,
  type: v.literal('worktree.adopt'),
})
export const worktreeReleaseCommandSchema = v.strictObject({
  ...target,
  type: v.literal('worktree.release'),
})
export const worktreeResolveMissingCommandSchema = v.strictObject({
  ...target,
  type: v.literal('worktree.resolve-missing'),
  authorization: worktreeMissingAuthorizationSchema,
})
export const worktreeClientCommandSchemas = [
  worktreeRetryCommandSchema,
  worktreeCleanupCommandSchema,
  worktreeForceCleanupCommandSchema,
  worktreeRetainCommandSchema,
  worktreeAdoptCommandSchema,
  worktreeReleaseCommandSchema,
  worktreeResolveMissingCommandSchema,
] as const

const cleanupResult = { ...target, ...operation, mode: worktreeCleanupModeSchema }
const metadata = { branch: v.nullable(text), headCommit: v.nullable(text) }
export const worktreeInternalCommandSchemas = [
  v.object({
    ...target,
    type: v.literal('worktree.create.complete'),
    ...operation,
    headCommit: text,
  }),
  v.object({ ...target, type: v.literal('worktree.create.fail'), ...operation, errorCode: text }),
  v.object({ ...cleanupResult, type: v.literal('worktree.cleanup.complete') }),
  v.variant(
    'reason',
    worktreeCleanupBlockerSchema.options.map((schema) =>
      v.object({
        ...cleanupResult,
        type: v.literal('worktree.cleanup.blocked'),
        ...schema.entries,
      }),
    ),
  ),
  v.object({ ...cleanupResult, type: v.literal('worktree.cleanup.fail'), errorCode: text }),
  v.object({ ...target, type: v.literal('worktree.mark-missing') }),
  v.object({
    ...target,
    type: v.literal('worktree.metadata.refresh'),
    expectedMetadataVersion: count,
    ...metadata,
  }),
  v.object({
    ...target,
    type: v.literal('worktree.pull-request.sync'),
    branch: text,
    pullRequest: worktreePullRequestSchema,
  }),
  v.object({
    ...target,
    type: v.literal('worktree.orphan.register'),
    projectId: projectIdSchema,
    canonicalPath: text,
    path: v.string(),
    ...metadata,
    pathKind: v.picklist(['id-derived', 'legacy']),
    reason: v.picklist(['unprojected-managed-path', 'stale-git-admin']),
  }),
  v.object({ ...worktreeRetainCommandSchema.entries, verified: v.literal(true) }),
  v.object({
    ...worktreeAdoptCommandSchema.entries,
    verified: v.literal(true),
    branch: v.nullable(text),
    headCommit: text,
  }),
  v.object({ ...worktreeResolveMissingCommandSchema.entries, verified: v.literal(true) }),
  v.object({
    commandId: commandIdSchema,
    type: v.literal('session.worktree.release'),
    sessionId: sessionIdSchema,
    turnId: turnIdSchema,
    ...operation,
  }),
] as const

export const terminalLeaseIdSchema = v.pipe(v.string(), v.uuid(), v.brand('TerminalLeaseId'))
export const terminalLeaseStateSchema = v.picklist([
  'requested',
  'claimed',
  'active',
  'termination-requested',
  'ended',
  'ownership-unknown',
])
export const terminalLeaseSchema = v.object({
  terminalLeaseId: terminalLeaseIdSchema,
  worktreeId: worktreeIdSchema,
  runtimeEpoch: text,
  state: terminalLeaseStateSchema,
  createdAt: text,
  updatedAt: text,
})
const leaseCommand = { ...target, terminalLeaseId: terminalLeaseIdSchema, runtimeEpoch: text }
export const terminalLeaseCommandSchemas = [
  v.object({ ...leaseCommand, type: v.literal('terminal.lease.request') }),
  v.object({ ...leaseCommand, type: v.literal('terminal.lease.claim') }),
  v.object({ ...leaseCommand, type: v.literal('terminal.lease.activate') }),
  v.object({ ...leaseCommand, type: v.literal('terminal.lease.terminate') }),
  v.object({ ...leaseCommand, type: v.literal('terminal.lease.end') }),
  v.object({ ...leaseCommand, type: v.literal('terminal.lease.mark-unknown') }),
] as const

const changed = { worktreeId: worktreeIdSchema, updatedAt: text }
export const WORKTREE_EVENT_PAYLOADS = {
  'worktree.create-requested': v.object({
    ...worktreeProvisioningSchema.entries,
    ...operation,
    createdAt: text,
    updatedAt: text,
  }),
  'worktree.created': v.object({ ...changed, ...operation, headCommit: text }),
  'worktree.creation-failed': v.object({ ...changed, ...operation, errorCode: text }),
  'worktree.cleanup-requested': v.variant('mode', [
    v.object({ ...changed, ...operation, mode: v.literal('safe') }),
    v.object({
      ...changed,
      ...operation,
      mode: v.literal('discard-changes'),
      ...worktreeCleanupAuthorizationSchema.entries,
    }),
  ]),
  'worktree.cleanup-blocked': v.variant(
    'reason',
    worktreeCleanupBlockerSchema.options.map((schema) =>
      v.object({ ...changed, ...operation, mode: worktreeCleanupModeSchema, ...schema.entries }),
    ),
  ),
  'worktree.cleanup-failed': v.object({
    ...changed,
    ...operation,
    mode: worktreeCleanupModeSchema,
    errorCode: text,
  }),
  'worktree.removed': v.object({ ...changed, ...operation, removedAt: text }),
  'worktree.retained': v.object(changed),
  'worktree.released': v.object(changed),
  'worktree.adopted': v.object({ ...changed, branch: v.nullable(text), headCommit: text }),
  'worktree.missing': v.object(changed),
  'worktree.metadata-refreshed': v.object({ ...changed, ...metadata, metadataVersion: count }),
  'worktree.pull-request-synced': v.object({
    ...changed,
    branch: text,
    pullRequest: worktreePullRequestSchema,
  }),
  'worktree.orphan-registered': v.object({
    ...changed,
    projectId: projectIdSchema,
    canonicalPath: text,
    path: v.string(),
    ...metadata,
    pathKind: v.picklist(['id-derived', 'legacy']),
    reason: v.picklist(['unprojected-managed-path', 'stale-git-admin']),
    createdAt: text,
  }),
  'session.worktree-blocked': v.object({
    ...changed,
    sessionId: sessionIdSchema,
    turnId: v.optional(turnIdSchema),
  }),
  'session.worktree-released': v.object({
    ...changed,
    sessionId: sessionIdSchema,
    turnId: turnIdSchema,
    ...operation,
  }),
  'terminal.lease-updated': terminalLeaseSchema,
} as const

export type SessionWorktreeTarget = v.InferOutput<typeof sessionWorktreeTargetSchema>
export type WorktreeLifecycle = v.InferOutput<typeof worktreeLifecycleSchema>
export type WorktreeProvisioning = v.InferOutput<typeof worktreeProvisioningSchema>
export type WorktreeCleanupEligibility = v.InferOutput<typeof worktreeCleanupEligibilitySchema>
export type WorktreeCreationCapability = v.InferOutput<typeof worktreeCreationCapabilitySchema>
export type WorktreeCleanupPreview = v.InferOutput<typeof worktreeCleanupPreviewSchema>
export type WorktreeMissingPreview = v.InferOutput<typeof worktreeMissingPreviewSchema>
export type TerminalLease = v.InferOutput<typeof terminalLeaseSchema>
export type WorktreePullRequest = v.InferOutput<typeof worktreePullRequestSchema>
export type TerminalLeaseId = v.InferOutput<typeof terminalLeaseIdSchema>
