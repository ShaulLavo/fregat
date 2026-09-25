import { orchestrationServerConfig } from '@workspace/client-core/test/orchestration-server-config'
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_PROVIDER_DRIVER_KIND,
  DEFAULT_PROVIDER_INSTANCE_ID,
  DEFAULT_RUNTIME_MODE,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type OrchestrationWorktreeShell,
  type OrchestrationSession,
  type OrchestrationShellSnapshot,
  type OrchestrationSessionActivity,
  type OrchestrationSessionShell,
  type ProviderModel,
  type ProviderSnapshot,
  environmentIdSchema,
  eventIdSchema,
  messageIdSchema,
  projectIdSchema,
  sessionIdSchema,
  worktreeIdSchema,
  turnIdSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import type {
  ChatSession,
  ChatTurnDiffSummary,
  ProjectionSession,
} from '@workspace/client-core/chat/types'

export const TEST_ENVIRONMENT_ID = orchestrationServerConfig().environmentId
export const TEST_PROJECT_ID = v.parse(projectIdSchema, '609d2bd3-7993-5564-9918-c603beaa32c6')
export const TEST_WORKTREE_ID = v.parse(worktreeIdSchema, 'dfc43652-d2f6-554d-ab37-88239fa016f6')
export const TEST_SESSION_ID = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')

function timestamp(index: number) {
  return `2026-05-28T00:00:0${index}.000Z`
}

export function sessionActivity(
  overrides: Partial<OrchestrationSessionActivity> = {},
): OrchestrationSessionActivity {
  return {
    createdAt: timestamp(3),
    id: v.parse(eventIdSchema, 'event-activity-1'),
    kind: 'approval.requested',
    payload: {},
    sequence: 1,
    summary: 'Approval requested',
    sessionId: TEST_SESSION_ID,
    tone: 'approval',
    turnId: v.parse(turnIdSchema, 'turn-1'),
    ...overrides,
  }
}

export function chatMessage(overrides: Partial<OrchestrationMessage> = {}): OrchestrationMessage {
  return {
    attachments: [],
    createdAt: timestamp(0),
    id: v.parse(messageIdSchema, 'message-1'),
    role: 'assistant',
    streaming: false,
    text: 'Hello from the assistant.',
    sessionId: TEST_SESSION_ID,
    turnId: null,
    updatedAt: timestamp(0),
    ...overrides,
  }
}

export function turnDiffSummary(overrides: Partial<ChatTurnDiffSummary> = {}): ChatTurnDiffSummary {
  return {
    assistantMessageId: v.parse(messageIdSchema, 'message-1'),
    checkpointRef: 'checkpoint-1',
    checkpointTurnCount: 1,
    completedAt: timestamp(2),
    files: [
      { additions: 12, deletions: 4, kind: 'modified', path: 'src/a.ts' },
      { additions: 6, deletions: 0, kind: 'modified', path: 'src/b.ts' },
    ],
    status: 'ready',
    sessionId: TEST_SESSION_ID,
    turnId: v.parse(turnIdSchema, 'turn-1'),
    ...overrides,
  }
}

export function sessionShell(
  overrides: Partial<OrchestrationSessionShell> = {},
): OrchestrationSessionShell {
  const turnId = v.parse(turnIdSchema, 'turn-1')
  return {
    archivedAt: null,
    createdAt: timestamp(1),
    hasActionableProposedPlan: false,
    id: TEST_SESSION_ID,
    worktreeId: TEST_WORKTREE_ID,
    origin: 'platform',
    attentionState: 'working',
    attentionReason: 'active',
    acknowledgedFailureThroughSequence: null,
    hasError: false,
    settledOverride: null,
    snoozedUntil: null,
    pinnedAt: null,
    pinOrderKey: null,
    interactionMode: DEFAULT_INTERACTION_MODE,
    latestTurn: {
      providerStartState: 'adopted',
      providerStartGeneration: 1,
      providerStartSequence: 1,
      runtimeEpoch: 'test-epoch',
      assistantMessageId: null,
      completedAt: null,
      requestedAt: timestamp(1),
      startedAt: timestamp(2),
      state: 'running',
      turnId,
    },
    latestUserMessageAt: timestamp(1),
    modelSelection: { model: 'claude-opus-5', providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID },
    pendingApprovalCount: 0,
    pendingUserInputCount: 0,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    runtime: {
      activeTurnId: turnId,
      lastError: null,
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
      providerName: 'Codex',
      providerBindingHandle: null,
      providerConversationMarker: null,
      providerResumeCursor: null,
      runtimeEpoch: 'test-runtime-1',
      runtimeMode: DEFAULT_RUNTIME_MODE,
      status: 'running',
      sessionId: TEST_SESSION_ID,
      updatedAt: timestamp(2),
    },
    title: 'Session',
    updatedAt: timestamp(2),
    ...overrides,
  }
}

export function projectionSession(overrides: Partial<ProjectionSession> = {}): ProjectionSession {
  const source = sessionShell()
  return {
    ...source,
    detailSynced: false,
    liveTurn: source.latestTurn,
    metaSource: 'shell',
    pinOrderKey: null,
    runtimeKnown: true,
    ...overrides,
  }
}

export function session(overrides: Partial<ChatSession> = {}): ChatSession {
  const { liveTurn: _liveTurn, ...source } = projectionSession()
  return {
    ...source,
    project: chatProject(),
    worktree: chatWorktree(),
    activities: [],
    messages: [],
    proposedPlans: [],
    turnDiffSummaries: [],
    ...overrides,
  }
}

export function orchestrationSession(
  overrides: Partial<OrchestrationSession> = {},
): OrchestrationSession {
  return {
    ...sessionShell(),
    activities: [],
    messages: [],
    deletedAt: null,
    deletion: null,
    ...overrides,
  }
}

export function chatProject(
  overrides: Partial<OrchestrationProjectShell> = {},
): OrchestrationProjectShell {
  return {
    createdAt: timestamp(0),
    defaultModelSelection: null,
    id: TEST_PROJECT_ID,
    orderKey: null,
    repositoryKey: 'test-repository-key',
    repositoryKind: 'git',
    repositoryIdentity: {
      source: 'git-remote',
      remoteName: 'origin',
      canonical: 'github.com/example/platform',
      host: 'github.com',
      path: 'example/platform',
    },
    scripts: [],
    title: 'platform',
    updatedAt: timestamp(1),
    ...overrides,
  }
}

export function chatWorktree(
  overrides: Partial<OrchestrationWorktreeShell> = {},
): OrchestrationWorktreeShell {
  return {
    id: TEST_WORKTREE_ID,
    projectId: TEST_PROJECT_ID,
    registrationGeneration: 0,
    operationId: null,
    lifecycle: { state: 'ready' },
    baseWorktreeId: null,
    baseCommit: null,
    headCommit: null,
    metadataVersion: 0,
    pathKind: 'legacy',
    activeTerminalCount: 0,
    terminalOwnershipUnknown: false,
    externalDriverUnverified: false,
    removedAt: null,
    worktreeCreationCapability: { allowed: true },
    cleanupEligibility: {
      reason: 'protected',
      nonDeletedSessionCount: 0,
      canResolveMissing: false,
    },
    canonicalPath: '/repo/platform',
    path: '/repo/platform',
    branch: null,
    kind: 'current',
    ownership: 'protected',
    createdAt: timestamp(0),
    updatedAt: timestamp(1),
    ...overrides,
  }
}

export function shellSnapshot({
  projects = [chatProject()],
  worktrees = [chatWorktree()],
  sessions = [sessionShell()],
}: {
  projects?: OrchestrationProjectShell[]
  worktrees?: OrchestrationWorktreeShell[]
  sessions?: OrchestrationSessionShell[]
} = {}): OrchestrationShellSnapshot {
  return { projects, worktrees, sessions, snapshotSequence: 1, updatedAt: timestamp(2) }
}

export function providerModel(overrides: Partial<ProviderModel> = {}): ProviderModel {
  return {
    capabilities: null,
    isCustom: false,
    name: 'GPT-5.5 Codex',
    shortName: 'GPT-5.5',
    slug: 'gpt-5.5',
    ...overrides,
  }
}

export function providerSnapshot(overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    auth: { status: 'authenticated' },
    checkedAt: timestamp(1),
    displayLabel: 'Codex',
    driverKind: DEFAULT_PROVIDER_DRIVER_KIND,
    enabled: true,
    installed: true,
    models: [],
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    runtimeModes: [DEFAULT_RUNTIME_MODE],
    status: 'ready',
    traits: {
      supportsApprovals: false,
      supportsFullAccess: true,
      supportsInterrupt: true,
      supportsSessionStop: true,
      supportsStreaming: true,
      supportsUserInput: false,
    },
    version: '1.0.0',
    ...overrides,
  }
}

export function fixtureSessionId(index: number) {
  if (index === 1) return TEST_SESSION_ID
  return v.parse(sessionIdSchema, `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`)
}

export function fixtureEnvironmentId(index: number) {
  if (index === 1) return TEST_ENVIRONMENT_ID
  return v.parse(
    environmentIdSchema,
    `00000000-0000-4000-9000-${index.toString(16).padStart(12, '0')}`,
  )
}
