import type {
  TurnEndReason,
  ApprovalRequestId,
  ChatAttachment,
  ChatAgent,
  ChatAgentTool,
  InteractionMode,
  ModelSelection,
  ProviderApprovalDecision,
  ProviderApprovalOption,
  ProviderAgent,
  ProviderAuth,
  ProviderBackgroundTask,
  ProviderDriverKind,
  ProviderMcpServer,
  ProviderMcpSignIn,
  ProviderSessionHooks,
  ProviderInstanceId,
  ProviderLoginAttempt,
  ProviderSignInMethod,
  ProviderSkill,
  ProviderSlashCommand,
  SessionRuntimeStatus,
  SessionTurnKind,
  ProviderSnapshot,
  ProviderUserInputAnswers,
  RuntimeMode,
  SessionId,
  SessionForkSource,
  TurnId,
  UserInputQuestions,
} from '@workspace/contracts'
import type { ProviderUsageAmounts, ProviderUsageTotals } from './utils/usage-totals'
import type { ProviderUsageProbe, ProviderUsageUpdate } from './utils/usage-windows'

export type ProviderTurnInput = {
  attachments: readonly ChatAttachment[]
  attachmentsDir?: string
  cwd: string
  ephemeral?: boolean
  resumeExisting?: boolean
  interactionMode: InteractionMode
  /** `compact` compacts the conversation instead of answering `messageText`. */
  kind?: SessionTurnKind
  messageText: string
  modelSelection: ModelSelection
  /** A JSON schema the turn's final message must match; Codex takes it per turn. */
  outputSchema?: Record<string, unknown>
  sessionId: SessionId
  runtimeEpoch: string
  providerInstanceId: ProviderInstanceId
  /**
   * Cursor of the conversation this turn continues, filled in by
   * `ProviderService` from the persisted binding. Without it a turn that has to
   * (re)start a session — after a restart, or after a model switch — would open
   * a brand-new provider conversation and lose the history.
   */
  providerResumeCursor?: unknown | null
  runtimeMode: RuntimeMode
  turnId: TurnId
}

/** Captured when the fork is created, before the source can advance again. */
export type ProviderForkStart = SessionForkSource['native']

export type ProviderRuntimeStartInput = {
  runtimeEpoch: string
  /** The harness agent definition the session runs as; set at the first start. */
  agent?: string
  fork?: ProviderForkStart
  resumeExisting?: boolean
  cwd: string
  ephemeral?: boolean
  interactionMode?: InteractionMode
  modelSelection: ModelSelection
  /** A JSON schema every final message must match; Claude takes it per session. */
  outputSchema?: Record<string, unknown>
  providerInstanceId: ProviderInstanceId
  providerResumeCursor?: unknown | null
  runtimeMode: RuntimeMode
  sessionId: SessionId
}

export type ProviderTurnSteerInput = Pick<
  ProviderTurnInput,
  'sessionId' | 'turnId' | 'messageText' | 'attachments' | 'attachmentsDir'
>

export type ProviderTurnControlInput = {
  sessionId: SessionId
  turnId?: TurnId
}

export type ProviderApprovalResponseInput = {
  decision: ProviderApprovalDecision
  requestId: ApprovalRequestId
  sessionId: SessionId
}

export type ProviderUserInputResponseInput = {
  answers: ProviderUserInputAnswers
  requestId: ApprovalRequestId
  sessionId: SessionId
}

type ProviderRuntimeBaseEvent = {
  agent?: ChatAgent
  createdAt: string
  eventId: string
  itemId?: string
  provider?: ProviderDriverKind
  providerInstanceId?: ProviderInstanceId
  providerName?: string
  providerRefs?: ProviderRefs
  providerBindingHandle?: string | null
  requestId?: string
  raw?: RuntimeEventRaw
  runtimeMode?: RuntimeMode
  sessionId: SessionId
  turnId?: TurnId
}

type RuntimeEventRawSource =
  | 'codex.app-server.notification'
  | 'codex.app-server.request'
  | 'codex.app-server.stderr'
  | 'codex.eventmsg'
  | 'codex.sdk.thread-event'
  | 'claude.sdk.message'
  | 'claude.sdk.permission'

type RuntimeEventRaw = {
  messageType?: string
  method?: string
  payload: unknown
  source: RuntimeEventRawSource
}

type ProviderRefs = {
  providerThreadId?: string
  providerItemId?: string
  providerRequestId?: string
  providerTurnId?: string
}

type ProviderRuntimeContentStreamKind =
  | 'assistant_text'
  | 'reasoning_text'
  | 'reasoning_summary_text'
  | 'plan_text'
  | 'command_output'
  | 'file_change_output'
  | 'unknown'

type ProviderRuntimeItemStatus = 'inProgress' | 'completed' | 'failed' | 'declined'

type ProviderRuntimeSessionState = 'active' | 'idle' | 'archived' | 'closed' | 'compacted' | 'error'

type ProviderRuntimeTurnState = 'completed' | 'failed' | 'interrupted' | 'cancelled'

type ProviderRuntimePlanStepStatus = 'pending' | 'inProgress' | 'completed'

/** `blocked` is a hook that refused the action it guarded, which is not the same as failing. */
export type ProviderHookOutcome = 'success' | 'blocked' | 'error' | 'cancelled'

/** A session cron, `ScheduleWakeup` or `/loop` as the harness reports it (five-field cron). */
export type ProviderHarnessSchedule = {
  id: string
  schedule: string
  recurring: boolean
  prompt: string
}

export type ProviderRuntimeEvent = ProviderRuntimeEventPayload & { runtimeEpoch: string }

export type ProviderRuntimeEventPayload =
  | {
      createdAt: string
      eventId: string
      providerInstanceId: ProviderInstanceId
      providerName?: string
      providerBindingHandle: string | null
      runtimeMode?: RuntimeMode
      status: SessionRuntimeStatus
      sessionId: SessionId
      turnId: TurnId | null
      type: 'runtime.set'
      lastError?: string | null
    }
  | {
      createdAt: string
      delta: string
      eventId: string
      messageId: string
      sessionId: SessionId
      turnId: TurnId
      type: 'assistant.delta'
    }
  | {
      completedAt: string
      eventId: string
      messageId: string
      sessionId: SessionId
      turnId: TurnId
      type: 'assistant.complete'
    }
  | {
      createdAt: string
      detail?: string
      eventId: string
      kind: string
      payload?: unknown
      summary: string
      sessionId: SessionId
      tone: 'info' | 'tool' | 'thinking' | 'approval' | 'error'
      turnId: TurnId | null
      type: 'activity.append'
    }
  | {
      createdAt: string
      eventId: string
      planId?: string
      planMarkdown: string
      sessionId: SessionId
      turnId: TurnId | null
      type: 'proposed-plan.upsert'
      updatedAt?: string
    }
  | (ProviderRuntimeBaseEvent & {
      type: 'content.delta'
      payload: {
        contentIndex?: number
        delta: string
        streamKind: ProviderRuntimeContentStreamKind
        summaryIndex?: number
      }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'item.started'
      payload: {
        data?: unknown
        detail?: string
        itemType: string
        status?: ProviderRuntimeItemStatus
        title?: string
      }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'item.completed'
      payload: {
        data?: unknown
        detail?: string
        itemType: string
        status?: ProviderRuntimeItemStatus
        title?: string
      }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'request.opened'
      payload: {
        options?: readonly ProviderApprovalOption[]
        /** No one-keystroke approve: the harness marked this ask risky. */
        defaultToNo?: boolean
        args?: unknown
        detail?: string
        requestType: string
      }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'request.resolved'
      payload: {
        decision?: string
        requestType: string
        resolution?: unknown
      }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'user-input.requested'
      /**
       * Adapters build these out of untyped provider JSON, so the contract here
       * states the target shape rather than a guarantee: ingestion re-parses
       * every question and drops the ones that miss it.
       */
      payload: { questions: UserInputQuestions; responseMode?: 'message' }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'user-input.resolved'
      payload: { answers: Record<string, unknown> }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'task.started'
      payload: {
        taskType?: string
        status?: string
        description?: string
        taskId: string
      }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'task.progress'
      payload: {
        taskType?: string
        status?: string
        tool?: ChatAgentTool
        description: string
        lastToolName?: string
        summary?: string
        taskId: string
        usage?: unknown
      }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'task.completed'
      payload: {
        taskType?: string
        status: 'completed' | 'failed' | 'stopped'
        summary?: string
        taskId: string
        usage?: unknown
      }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'runtime.warning'
      payload: { detail?: unknown; message: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'runtime.error'
      payload: { class?: string; detail?: unknown; message: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'runtime.started'
      payload: { message?: string; resume?: unknown }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'runtime.configured'
      payload: { config: Record<string, unknown> }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'runtime.state.changed'
      payload: { detail?: unknown; reason?: string; state: SessionRuntimeStatus }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'runtime.exited'
      payload: { exitKind?: 'graceful' | 'error'; reason?: string; recoverable?: boolean }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'conversation.started'
      payload: { providerConversationMarker?: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'conversation.state.changed'
      payload: { detail?: unknown; state: ProviderRuntimeSessionState }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'conversation.metadata.updated'
      payload: { metadata?: Record<string, unknown>; name?: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'conversation.token-usage.updated'
      payload: { usage: Record<string, unknown> & { usedTokens?: number } }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'conversation.realtime.started'
      payload: { realtimeSessionId?: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'conversation.realtime.item-added'
      payload: { item: unknown }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'conversation.realtime.audio.delta'
      payload: { audio: unknown }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'conversation.realtime.error'
      payload: { message: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'conversation.realtime.closed'
      payload: { reason?: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'turn.started'
      payload: { effort?: string; model?: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'turn.completed'
      payload: {
        /** Only a reason the harness itself reported; our own causes are projected from our events. */
        endReason?: TurnEndReason
        errorMessage?: string
        state: ProviderRuntimeTurnState
        usage?: unknown
      }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'turn.plan.updated'
      payload: {
        explanation?: string | null
        plan: Array<{ status: ProviderRuntimePlanStepStatus; step: string }>
      }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'turn.diff.updated'
      payload: { unifiedDiff: string }
    })
  | (ProviderRuntimeBaseEvent & {
      /** Every live, non-ambient background task; replaces the previous set. */
      type: 'tasks.roster'
      payload: { tasks: ProviderBackgroundTask[] }
    })
  | (ProviderRuntimeBaseEvent & {
      /** Every schedule the harness process holds after a turn; replaces the previous set. */
      type: 'schedules.updated'
      payload: { schedules: ProviderHarnessSchedule[] }
    })
  | (ProviderRuntimeBaseEvent & {
      /** The turn's answer in the shape its output schema asked for. */
      type: 'turn.structured-output'
      payload: { value: unknown }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'hook.started'
      payload: { hookEvent: string; hookId: string; hookName: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'hook.progress'
      payload: { hookId: string; output?: string; stderr?: string; stdout?: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'hook.completed'
      payload: {
        exitCode?: number
        hookEvent?: string
        hookId: string
        hookName?: string
        outcome: ProviderHookOutcome
        output?: string
        stderr?: string
        stdout?: string
      }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'tool.progress'
      payload: {
        elapsedSeconds?: number
        summary?: string
        toolName?: string
        toolUseId?: string
      }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'tool.summary'
      payload: { precedingToolUseIds?: string[]; summary: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'auth.status'
      payload: { error?: string; isAuthenticating?: boolean; output?: string[] }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'account.updated'
      payload: { account: unknown }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'account.rate-limits.updated'
      payload: ProviderUsageUpdate
    })
  | (ProviderRuntimeBaseEvent & {
      /** Running totals at the end of a turn; the usage recorder turns them into per-turn rows. */
      type: 'usage.totals'
      payload: { totals: ProviderUsageTotals[] }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'mcp.status.updated'
      payload: { status: unknown }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'mcp.oauth.completed'
      payload: { error?: string; name?: string; success: boolean }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'model.rerouted'
      payload: { fromModel: string; reason: string; toModel: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'config.warning'
      payload: { details?: string; path?: string; range?: unknown; summary: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'deprecation.notice'
      payload: { details?: string; summary: string }
    })
  | (ProviderRuntimeBaseEvent & {
      type: 'files.persisted'
      payload: {
        failed?: Array<{ error: string; filename: string }>
        files: Array<{ fileId: string; filename: string }>
      }
    })

type ProviderAdapterCapabilities = {
  conversationRollback: boolean
  /**
   * Whether the adapter implements `listCommands`. Optional so adapters whose
   * protocol has no listing request (codex, today) stay untouched.
   */
  listCommands?: boolean
  sessionModelSwitch: 'in-session' | 'unsupported'
  /**
   * Whether the adapter implements the optional auth members below. Optional so
   * adapters that cannot drive a sign-in flow (codex, mock) stay untouched.
   */
  signIn?: boolean
}

export type ProviderSignInInput = {
  email?: string
  method: ProviderSignInMethod
}

export type ProviderCommandCatalogInput = {
  /**
   * Directory to discover from. Skills and project commands are files on the
   * user's disk under the working directory, so the same provider answers
   * differently per project and a catalog read without a `cwd` sees only the
   * user-level ones.
   */
  cwd?: string
}

export type ProviderCommandCatalogResult = {
  agents: ProviderAgent[]
  commands: ProviderSlashCommand[]
  skills: ProviderSkill[]
}

/** Every root in one call: discovery may start a provider process per call. */
export type ProviderSessionDiscoveryInput = {
  cwds: readonly string[]
}

export type ProviderDiscoveredSession = {
  sessionId: SessionId
  cwd: string | null
  title: string
  sourceUpdatedAt: string
  gitBranch: string | null
}

export type ProviderSessionHistoryInput = {
  sessionId: SessionId
  cwd: string
}

export type ProviderForkInput = ProviderSessionHistoryInput & {
  conversationId: string
  providerTurnId: string
}

export type ProviderHistoryMessage = {
  sourceId: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string | null
}

/** One turn's usage for one model, read back from a transcript of a session begun elsewhere. */
export type ProviderImportedUsage = ProviderUsageAmounts & {
  billingKey: string
  /** Stable across re-reads: the prompt that opened the turn. */
  turnKey: string
  model: string
  recordedAt: string
}

export type ProviderAdapterRuntime = {
  runtimeEpoch: string
  cwd: string
  model: string
  providerInstanceId: ProviderInstanceId
  providerBindingHandle: string
  providerConversationMarker?: string
  providerResumeCursor?: unknown | null
  runtimeMode: RuntimeMode
  status: SessionRuntimeStatus
  sessionId: SessionId
}

export type ProviderAdapter = {
  operationTimeoutMs: number
  adapterKey: string
  /**
   * Current account state, read from the provider CLI rather than from a cached
   * snapshot. Present only when `capabilities.signIn` is true.
   */
  authStatus?: () => Promise<ProviderAuth>
  cancelSignIn?: (input: { attemptId: string }) => Promise<ProviderLoginAttempt | null>
  capabilities: ProviderAdapterCapabilities
  driverKind: ProviderDriverKind
  discoverSessions?: (input: ProviderSessionDiscoveryInput) => Promise<ProviderDiscoveredSession[]>
  /** The CLI this instance spawns. */
  executablePath?: () => Promise<string>
  /** Drops a remembered executable and version, after the CLI on disk was replaced. */
  forgetExecutable?: () => void
  readSessionHistory?: (input: ProviderSessionHistoryInput) => Promise<ProviderHistoryMessage[]>
  readSessionUsage?: (input: ProviderSessionHistoryInput) => Promise<ProviderImportedUsage[]>
  prepareFork?: (input: ProviderForkInput) => Promise<ProviderForkStart>
  /**
   * One full read of the account's plan windows, outside any turn. Throws when the
   * provider could not answer; the usage store keeps what it had.
   */
  consumeResetCredit?: (input: {
    idempotencyKey: string
    accountKey: string
    creditId: string
  }) => Promise<import('@workspace/contracts').ProviderResetCreditOutcome>
  readUsage?: () => Promise<ProviderUsageProbe>
  hasRuntime: (input: { sessionId: SessionId }) => Promise<boolean>
  interruptTurn: (input: ProviderTurnControlInput) => Promise<void>
  /**
   * The `/command` and `$skill` catalog for one working directory. Present only
   * when `capabilities.listCommands` is true.
   */
  listCommands?: (input: ProviderCommandCatalogInput) => Promise<ProviderCommandCatalogResult>
  respondApproval: (input: ProviderApprovalResponseInput) => Promise<void>
  respondUserInput: (input: ProviderUserInputResponseInput) => Promise<void>
  /** The session's MCP servers; null when it has no live provider process to ask. */
  mcpServers?: (input: { sessionId: SessionId }) => Promise<ProviderMcpServer[] | null>
  reconnectMcpServer?: (input: { name: string; sessionId: SessionId }) => Promise<void>
  signInMcpServer?: (input: { name: string; sessionId: SessionId }) => Promise<ProviderMcpSignIn>
  /** Hooks configured for the checkout; null when the session has no live provider process. */
  configuredHooks?: (input: {
    cwd: string
    sessionId: SessionId
  }) => Promise<Pick<ProviderSessionHooks, 'errors' | 'hooks'> | null>
  /** Stops one background task without stopping the agent. */
  stopBackgroundTask?: (input: { sessionId: SessionId; taskId: string }) => Promise<void>
  prepareRollbackSession: (input: {
    numTurns: number
    sessionId: SessionId
  }) => Promise<() => Promise<void>>
  /**
   * Starts an interactive sign-in. Returns as soon as the flow is running — the
   * user still has a browser round trip to finish — so callers poll
   * `signInAttempt` with the returned id until it leaves `pending`.
   */
  signIn?: (input: ProviderSignInInput) => Promise<ProviderLoginAttempt>
  signInAttempt?: (input: { attemptId: string }) => Promise<ProviderLoginAttempt | null>
  signOut?: () => Promise<void>
  snapshot: () => Promise<ProviderSnapshot>
  startRuntime: (input: ProviderRuntimeStartInput) => Promise<ProviderAdapterRuntime>
  sendTurn: (input: ProviderTurnInput) => Promise<void>
  steerTurn?: (input: ProviderTurnSteerInput) => Promise<void>
  subscribeEvents: (subscriber: (event: ProviderRuntimeEvent) => void) => () => void
  stopAll: () => Promise<void>
  stopRuntime: (input: { sessionId: SessionId }) => Promise<void>
}
