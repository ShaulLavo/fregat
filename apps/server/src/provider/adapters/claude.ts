import { spawn } from 'node:child_process'
import { ProviderProcessLifetime } from './process-lifetime'
import { createInternalError } from '../../observability/structured-errors'

import {
  query as claudeSdkQuery,
  type CanUseTool,
  type Options,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand,
} from '@anthropic-ai/claude-agent-sdk'
import {
  DEFAULT_CLAUDE_PROVIDER_SETTINGS,
  DEFAULT_INTERACTION_MODE,
  approvalRequestIdSchema,
  messageIdSchema,
  type ApprovalRequestId,
  type InteractionMode,
  type ProviderApprovalDecision,
  type ProviderInstanceId,
  type ProviderInstanceSettings,
  type ProviderSkill,
  type ProviderSlashCommand,
  type ProviderSnapshot,
  type RuntimeMode,
  type SessionId,
  type TurnId,
  type UserInputQuestions,
} from '@workspace/contracts'
import * as v from 'valibot'
import { defaultAttachmentsDir, readAttachmentBytes } from '../../attachments/store'
import {
  providerTurnSummary,
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from '../../orchestration/orchestration-logging'
import { ProviderRuntimeEventStream } from '../provider-runtime-event-stream'
import { sessionIdentityErrors } from '../structured-errors'
import {
  discoverClaudeSessions,
  readClaudeSessionHistory,
  type ClaudeDiscoveryRunner,
  type ClaudeHistoryRunner,
} from '../claude-discovery'
import type {
  ProviderAdapter,
  ProviderAdapterRuntime,
  ProviderApprovalResponseInput,
  ProviderCommandCatalogInput,
  ProviderCommandCatalogResult,
  ProviderRuntimeEvent,
  ProviderRuntimeEventPayload,
  ProviderRuntimeStartInput,
  ProviderSessionDiscoveryInput,
  ProviderSessionHistoryInput,
  ProviderSignInInput,
  ProviderTurnInput,
  ProviderUserInputResponseInput,
} from '../types'
import { activeProviderTurn, type ActiveProviderTurn } from './utils/active-turn'
import { providerErrorMessage } from './utils/adapters'
import {
  ClaudeAuthRunner,
  type ClaudeAuthState,
  type ClaudeLoginAttempt,
} from './utils/claude-auth'
import { claudeModelCatalog } from './utils/claude-models'
import { claudeModelId, claudeQueryOptions } from './utils/claude-query-options'
import {
  claudePromptText,
  claudeReasoning,
  claudeReasoningKey,
  type ClaudeReasoning,
} from './utils/claude-reasoning'
import {
  claudeImageMediaType,
  claudeUnsupportedAttachments,
  claudeUserMessage,
  type ResolvedAttachment,
} from './utils/claude-turn-input'
import { claudeUserInputAnswers, claudeUserInputQuestions } from './utils/claude-user-input'
import { asRecord, numberField, stringField } from './utils/records'
import { noop, runtimeEventId } from './utils/runtime-ids'
import { sessionInputFromTurn } from './utils/session-input'
import { normalizeWorkspaceCwd } from './utils/workspace-cwd'

/**
 * Budget for the CLI's `initialize` control response, which both the capability
 * probe and session start wait on. Amazon Bedrock runs an AWS credential-refresh
 * hook during init before the SDK answers, so codex's 8s
 * `PROVIDER_PROBE_TIMEOUT_MS` expires mid-init there and the provider is then
 * stuck "unverified" and unselectable in the picker rather than reporting an
 * error — hence the much longer budget. A healthy local CLI answers in ~0.5s.
 */
const CLAUDE_INIT_TIMEOUT_MS = 25_000

/** Placeholder payload for an attachment that is guaranteed to be dropped. */
const EMPTY_ATTACHMENT_BYTES = new Uint8Array(0)

export const CLAUDE_ADAPTER_CAPABILITIES = {
  listCommands: true,
  // Honest: `Query.setModel()` exists, and our prompt is a streaming
  // AsyncIterable, which is the only mode where that method works.
  sessionModelSwitch: 'in-session',
  signIn: true,
} satisfies ProviderAdapter['capabilities']

const CLAUDE_SIGNED_OUT_MESSAGE =
  'Claude Code is not signed in. Sign in from the provider menu, or run `claude auth login`.'

export type ClaudeCreateQuery = (input: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => Query

export type ClaudeAdapterOptions = {
  discoveryRunner?: ClaudeDiscoveryRunner
  historyRunner?: ClaudeHistoryRunner
  attachmentsDir?: string
  auth?: ClaudeAuthRunner
  createQuery?: ClaudeCreateQuery
  displayLabel?: string
  enabled?: boolean
  /**
   * Per-instance spawn env. Isolation rides on `CLAUDE_CONFIG_DIR`, never on
   * `HOME` — see `claudeQueryOptions` for why.
   */
  env?: NodeJS.ProcessEnv
  providerInstanceId?: ProviderInstanceId
}

type PendingClaudeApproval = {
  resolve: (result: PermissionResult) => void
  toolInput: Record<string, unknown>
  toolName: string
}

/** `toolInput` is kept because the SDK wants the questions echoed back beside the answers. */
type PendingClaudeUserInput = {
  resolve: (result: PermissionResult) => void
  toolInput: Record<string, unknown>
}

type InFlightClaudeTool = {
  itemType: string
  title: string
  toolName: string
}

type ClaudeSystemMessage = Extract<SDKMessage, { type: 'system' }>

type ClaudeSystemMessageOf<Subtype extends ClaudeSystemMessage['subtype']> = Extract<
  ClaudeSystemMessage,
  { subtype: Subtype }
>

/** `never` for the few event members that carry no payload — they use `emit`. */
type ClaudeRuntimeEventPayload<Type extends ProviderRuntimeEvent['type']> = Extract<
  ProviderRuntimeEvent,
  { payload: unknown; type: Type }
>['payload']

export class ClaudeProviderAdapter implements ProviderAdapter {
  readonly operationTimeoutMs = 30_000
  readonly adapterKey: ProviderInstanceId
  readonly capabilities = CLAUDE_ADAPTER_CAPABILITIES
  readonly driverKind = DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind
  private readonly attachmentsDir: string
  private readonly auth: ClaudeAuthRunner
  private readonly createQuery: ClaudeCreateQuery
  private readonly discoveryRunner: ClaudeDiscoveryRunner | undefined
  private readonly historyRunner: ClaudeHistoryRunner | undefined
  private readonly env: NodeJS.ProcessEnv
  private readonly events = new ProviderRuntimeEventStream()
  private readonly sessions = new Map<SessionId, ClaudeAgentSession>()
  private readonly settings: ProviderInstanceSettings

  /**
   * `createQuery` is the seam every test depends on: without it each test spawns
   * the real `claude` binary and talks to a real account. It covers `snapshot()`
   * as well as `sendTurn` — the capability probe is the call that spawns a
   * process, so injecting only the turn path would leave the binary reachable.
   * `auth` is the same idea for the CLI-level `claude auth …` commands, where an
   * un-injected `signIn` would open a real browser window.
   */
  constructor(options: ClaudeAdapterOptions = {}) {
    this.adapterKey =
      options.providerInstanceId ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.providerInstanceId
    this.attachmentsDir = options.attachmentsDir ?? defaultAttachmentsDir()
    this.env = options.env ?? process.env
    this.auth = options.auth ?? new ClaudeAuthRunner({ env: this.env })
    this.createQuery = options.createQuery ?? defaultClaudeCreateQuery
    this.discoveryRunner = options.discoveryRunner
    this.historyRunner = options.historyRunner
    this.settings = {
      ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
      displayLabel: options.displayLabel ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.displayLabel,
      enabled: options.enabled ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.enabled,
      providerInstanceId: this.adapterKey,
    }
  }

  async snapshot(): Promise<ProviderSnapshot> {
    const checkedAt = new Date().toISOString()
    recordChatPipelineInfo('chat.pipeline.claude_adapter.snapshot.start')

    try {
      const state = await this.readAuthState()
      const models = claudeModelCatalog()
      recordChatPipelineInfo('chat.pipeline.claude_adapter.snapshot.complete', {
        authStatus: state.auth.status,
        installed: true,
        modelCount: models.length,
        status: state.status,
      })

      return {
        ...this.settings,
        auth: state.auth,
        checkedAt,
        installed: true,
        models,
        status: state.status,
        supportsSignIn: true,
        version: null,
        ...(state.message ? { message: state.message } : {}),
      }
    } catch (error) {
      if (isMissingClaudeBinaryError(error))
        return unavailableClaudeSnapshot(checkedAt, this.settings)

      recordChatPipelineWarning('chat.pipeline.claude_adapter.snapshot.failed', {
        error,
        providerInstanceId: this.adapterKey,
      })
      return {
        ...this.settings,
        auth: { status: 'unknown' },
        checkedAt,
        installed: true,
        message: providerErrorMessage(error),
        models: [],
        status: 'error',
        supportsSignIn: true,
        version: null,
      }
    }
  }

  async authStatus() {
    const state = await this.readAuthState()
    return state.auth
  }

  /**
   * Reuses the capability probe: the same never-yielding prompt that reads
   * account state also carries the command list, and the skill list is one more
   * control request on the already-running CLI. No turn is spent either way.
   */
  async listCommands({ cwd }: ProviderCommandCatalogInput) {
    return probeClaudeCommandCatalog(this.createQuery, this.env, cwd)
  }

  async signIn(input: ProviderSignInInput) {
    const attempt = this.auth.startLogin(input)
    recordChatPipelineInfo('chat.pipeline.claude_adapter.sign_in.start', {
      attemptId: attempt.attemptId,
      method: input.method,
      state: attempt.state,
    })

    return this.withInstanceId(attempt)
  }

  async signInAttempt({ attemptId }: { attemptId: string }) {
    const attempt = this.auth.attempt(attemptId)
    return attempt ? this.withInstanceId(attempt) : null
  }

  async cancelSignIn({ attemptId }: { attemptId: string }) {
    const attempt = this.auth.cancel(attemptId)
    return attempt ? this.withInstanceId(attempt) : null
  }

  async signOut() {
    await this.auth.signOut()
    recordChatPipelineInfo('chat.pipeline.claude_adapter.sign_out.complete')
  }

  private withInstanceId(attempt: ClaudeLoginAttempt) {
    return { ...attempt, providerInstanceId: this.adapterKey }
  }

  /**
   * `claude auth status --json` is the authoritative signal; the SDK account
   * only supplies display detail (email, subscription tier) and is the fallback
   * when the CLI read itself is unreadable.
   */
  private async readAuthState() {
    const [cli, account] = await Promise.all([
      this.auth.status(),
      probeClaudeAccount(this.createQuery, this.env),
    ])

    return claudeAuthState(cli, account)
  }

  /** Adapter-local inspection, not part of the driver SPI. */
  async listActiveRuntimes() {
    return Array.from(this.sessions.values())
      .filter((session) => session.isActive())
      .map((session) => session.snapshot())
  }

  discoverSessions(request: ProviderSessionDiscoveryInput) {
    return discoverClaudeSessions({ request, env: this.env, runner: this.discoveryRunner })
  }

  readSessionHistory(request: ProviderSessionHistoryInput) {
    return readClaudeSessionHistory({ request, env: this.env, runner: this.historyRunner })
  }

  async hasRuntime({ sessionId }: { sessionId: SessionId }) {
    return this.sessions.get(sessionId)?.hasProcess() ?? false
  }

  async rollbackSession(): Promise<never> {
    throw createInternalError('Claude rollbackSession is not supported.')
  }

  subscribeEvents(subscriber: (event: ProviderRuntimeEvent) => void) {
    return this.events.subscribe(subscriber)
  }

  async startRuntime(input: ProviderRuntimeStartInput) {
    const session = await this.ensureRuntimeSession(input)
    return session.snapshot()
  }

  async sendTurn(input: ProviderTurnInput) {
    recordChatPipelineInfo('chat.pipeline.claude_adapter.start_turn.start', {
      ...providerTurnSummary(input),
    })
    const session = await this.ensureRuntimeSession(sessionInputFromTurn(input))
    await session.sendTurn({
      input,
      messageId: v.parse(messageIdSchema, `assistant:${input.turnId}`),
    })
    recordChatPipelineInfo('chat.pipeline.claude_adapter.start_turn.complete', {
      ...providerTurnSummary(input),
    })
  }

  async interruptTurn({ sessionId, turnId }: { sessionId: SessionId; turnId?: TurnId }) {
    recordChatPipelineInfo('chat.pipeline.claude_adapter.interrupt', { sessionId, turnId })
    await this.sessions.get(sessionId)?.interruptTurn(turnId)
  }

  async stopRuntime({ sessionId }: { sessionId: SessionId }) {
    recordChatPipelineInfo('chat.pipeline.claude_adapter.stop', { sessionId })
    const session = this.sessions.get(sessionId)
    if (!session) return

    await session.close()
    if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId)
  }

  async stopAll() {
    recordChatPipelineInfo('chat.pipeline.claude_adapter.stop_all', {
      sessionCount: this.sessions.size,
    })
    for (const sessionId of this.sessions.keys()) await this.stopRuntime({ sessionId })
  }

  async respondApproval(input: ProviderApprovalResponseInput) {
    await this.requireSession(input.sessionId, 'approval/respond').respondApproval(input)
  }

  /**
   * The SDK's analog of codex's `item/tool/requestUserInput` is the
   * `AskUserQuestion` tool arriving through `canUseTool`, so the answer travels
   * back as that tool's permission result rather than as its own control reply.
   */
  async respondUserInput(input: ProviderUserInputResponseInput) {
    await this.requireSession(input.sessionId, 'user-input/respond').respondUserInput(input)
  }

  private async ensureRuntimeSession(input: ProviderRuntimeStartInput) {
    const existing = this.sessions.get(input.sessionId)
    const cwd = normalizeWorkspaceCwd(input.cwd)
    const model = claudeModelId({
      modelSelection: input.modelSelection,
      providerInstanceId: input.providerInstanceId,
    })
    // Effort and thinking are baked into the query options at spawn time, so
    // they join cwd/model/runtimeMode in the reuse check: a session that switched
    // level has to get a new query, not a stale one that ignores it.
    const reasoning = claudeReasoning({
      modelSelection: input.modelSelection,
      providerInstanceId: input.providerInstanceId,
    })
    const reasoningKey = claudeReasoningKey(reasoning)
    // Plan mode is a spawn-time `permissionMode`, exactly like effort: reusing a
    // session across a switch runs the new mode against the old query, which is
    // what made "plan" silently behave as whatever the session started in.
    const interactionMode = input.interactionMode ?? DEFAULT_INTERACTION_MODE
    const ephemeral = input.ephemeral ?? false
    if (
      existing?.matches({
        cwd,
        runtimeEpoch: input.runtimeEpoch,
        ephemeral,
        interactionMode,
        model,
        reasoningKey,
        runtimeMode: input.runtimeMode,
      })
    ) {
      recordChatPipelineInfo('chat.pipeline.claude_adapter.session.reuse', {
        interactionMode,
        model,
        reasoning,
        runtimeMode: input.runtimeMode,
        runtimeEpoch: input.runtimeEpoch,
        sessionId: input.sessionId,
      })
      return existing
    }

    if (existing) {
      recordChatPipelineInfo('chat.pipeline.claude_adapter.session.replace', {
        interactionMode,
        model,
        reasoning,
        runtimeMode: input.runtimeMode,
        runtimeEpoch: input.runtimeEpoch,
        sessionId: input.sessionId,
      })
      await existing.close()
      this.sessions.delete(input.sessionId)
    }

    recordChatPipelineInfo('chat.pipeline.claude_adapter.session.start', {
      interactionMode,
      model,
      providerInstanceId: input.providerInstanceId,
      reasoning,
      runtimeMode: input.runtimeMode,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
    })
    const session = await ClaudeAgentSession.start({
      onCreated: (session) => this.sessions.set(input.sessionId, session),
      attachmentsDir: this.attachmentsDir,
      createQuery: this.createQuery,
      cwd,
      emit: (event) => this.events.publish(event),
      env: this.env,
      ephemeral,
      interactionMode,
      model,
      providerInstanceId: input.providerInstanceId,
      reasoning,
      resumeExisting: input.resumeExisting,
      runtimeMode: input.runtimeMode,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
    })
    this.sessions.set(input.sessionId, session)
    recordChatPipelineInfo('chat.pipeline.claude_adapter.session.started', {
      interactionMode,
      model,
      reasoning,
      runtimeMode: input.runtimeMode,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
    })

    return session
  }

  private requireSession(sessionId: SessionId, operation: string) {
    const session = this.sessions.get(sessionId)
    if (session?.isActive()) return session

    throw createInternalError(
      `Claude ${operation} requires an active session for session ${sessionId}.`,
    )
  }
}

class ClaudeAgentSession {
  private readonly abortController = new AbortController()
  private readonly attachmentsDir: string
  private readonly cwd: string
  private readonly emit: (event: ProviderRuntimeEventPayload) => void
  private readonly ephemeral: boolean
  private readonly inFlightTools = new Map<string, InFlightClaudeTool>()
  private readonly interactionMode: InteractionMode
  private readonly model: string
  private readonly pendingApprovals = new Map<ApprovalRequestId, PendingClaudeApproval>()
  private readonly pendingUserInputs = new Map<ApprovalRequestId, PendingClaudeUserInput>()
  private readonly prompt = new ClaudePromptQueue()
  private readonly providerInstanceId: ProviderTurnInput['providerInstanceId']
  private readonly reasoning: ClaudeReasoning
  private readonly reasoningKey: string
  private readonly runtimeMode: RuntimeMode
  private readonly runtimeEpoch: string
  private readonly sessionId: SessionId
  private providerConversationMarker: string | null = null
  private activeProviderTurnId: string | null = null
  private activeTurn: ActiveProviderTurn | null = null
  private query: Query | null = null
  private pumpCompletion: Promise<void> | null = null
  private streamEnded = true
  private readonly processes: ProviderProcessLifetime[] = []
  private status: ProviderAdapterRuntime['status'] = 'starting'

  private constructor(input: {
    attachmentsDir: string
    cwd: string
    emit: (event: ProviderRuntimeEvent) => void
    ephemeral: boolean
    interactionMode: InteractionMode
    model: string
    providerInstanceId: ProviderTurnInput['providerInstanceId']
    reasoning: ClaudeReasoning
    runtimeMode: RuntimeMode
    runtimeEpoch: string
    sessionId: SessionId
  }) {
    this.attachmentsDir = input.attachmentsDir
    this.cwd = input.cwd
    this.emit = (event) => input.emit({ ...event, runtimeEpoch: input.runtimeEpoch })
    this.runtimeEpoch = input.runtimeEpoch
    this.ephemeral = input.ephemeral
    this.interactionMode = input.interactionMode
    this.model = input.model
    this.providerInstanceId = input.providerInstanceId
    this.reasoning = input.reasoning
    this.reasoningKey = claudeReasoningKey(input.reasoning)
    this.runtimeMode = input.runtimeMode
    this.sessionId = input.sessionId
  }

  // Streaming input withholds init until the first prompt; adopt the caller's UUID before it.
  static async start(input: {
    onCreated: (session: ClaudeAgentSession) => void
    attachmentsDir: string
    createQuery: ClaudeCreateQuery
    cwd: string
    emit: (event: ProviderRuntimeEvent) => void
    env: NodeJS.ProcessEnv
    ephemeral: boolean
    interactionMode: InteractionMode
    model: string
    providerInstanceId: ProviderTurnInput['providerInstanceId']
    reasoning: ClaudeReasoning
    resumeExisting?: boolean
    runtimeMode: RuntimeMode
    runtimeEpoch: string
    sessionId: SessionId
  }) {
    recordChatPipelineInfo('chat.pipeline.claude_session.start', {
      interactionMode: input.interactionMode,
      model: input.model,
      ephemeral: input.ephemeral,
      providerInstanceId: input.providerInstanceId,
      reasoning: input.reasoning,
      runtimeMode: input.runtimeMode,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
    })
    // Resuming keeps the id the CLI already persisted; otherwise we name the new
    // conversation ourselves. `claudeQueryOptions` drops one of the two.
    const sessionId = input.sessionId
    const session = new ClaudeAgentSession({ ...input, sessionId })
    input.onCreated(session)
    const options = claudeQueryOptions({
      abortController: session.abortController,
      canUseTool: session.canUseTool(),
      cwd: input.cwd,
      env: input.env,
      persistSession: input.ephemeral ? false : undefined,
      interactionMode: input.interactionMode,
      model: input.model,
      reasoning: input.reasoning,
      resumeExisting: input.resumeExisting,
      runtimeMode: input.runtimeMode,
      sessionId,
    })

    try {
      const query = input.createQuery({
        options: {
          ...options,
          spawnClaudeCodeProcess: (spawnOptions) => session.spawnProcess(spawnOptions),
        },
        prompt: session.prompt,
      })
      session.attach(query)
      // Proves the CLI actually launched and finished its local init IPC. It
      // costs no turn and needs no prompt, unlike the `init` message.
      await withClaudeTimeout(
        query.initializationResult(),
        CLAUDE_INIT_TIMEOUT_MS,
        'Claude session start timed out.',
      )
      session.status = 'ready'
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.claude_session.start.failed', {
        error,
        sessionId: input.sessionId,
      })
      await session.close()
      throw error
    }

    recordChatPipelineInfo('chat.pipeline.claude_session.started', {
      providerBindingHandle: session.providerBindingHandle(),
      sessionId: input.sessionId,
    })
    session.emitSessionStarted()
    session.emitConversationStarted()

    return session
  }

  matches(input: {
    cwd: string
    runtimeEpoch: string
    ephemeral: boolean
    interactionMode: InteractionMode
    model: string
    reasoningKey: string
    runtimeMode: RuntimeMode
  }) {
    if (!this.isActive()) return false
    if (this.runtimeEpoch !== input.runtimeEpoch) return false
    if (this.cwd !== input.cwd) return false
    if (this.ephemeral !== input.ephemeral) return false
    if (this.interactionMode !== input.interactionMode) return false
    if (this.model !== input.model) return false
    if (this.reasoningKey !== input.reasoningKey) return false

    return this.runtimeMode === input.runtimeMode
  }

  isActive() {
    return this.status !== 'stopped' && !this.abortController.signal.aborted
  }

  snapshot(): ProviderAdapterRuntime {
    return {
      runtimeEpoch: this.runtimeEpoch,
      cwd: this.cwd,
      model: this.model,
      providerInstanceId: this.providerInstanceId,
      providerBindingHandle: this.providerBindingHandle(),
      providerConversationMarker: this.providerConversationMarker ?? this.sessionId,
      providerResumeCursor: null,
      runtimeMode: this.runtimeMode,
      status: this.status,
      sessionId: this.sessionId,
    }
  }

  /**
   * One turn at a time, enforced. `SDKResultMessage` carries no turn identifier
   * — only `uuid` and `session_id` — so everything between "prompt pushed" and
   * "result received" is attributed to the active turn. A second concurrent turn
   * would silently steal the first one's deltas and completion, so it is
   * rejected instead.
   */
  async sendTurn({ input, messageId }: { input: ProviderTurnInput; messageId: string }) {
    if (this.activeTurn) {
      throw createInternalError(
        `Claude session for session ${this.sessionId} already has a turn in flight.`,
      )
    }
    if (!this.isActive()) {
      throw createInternalError(`Claude session for session ${this.sessionId} is not active.`)
    }

    recordChatPipelineInfo('chat.pipeline.claude_session.send_turn.start', {
      ...providerTurnSummary(input),
      messageId,
      providerBindingHandle: this.providerBindingHandle(),
    })
    const turn = activeProviderTurn({ canonicalTurnId: input.turnId, messageId })
    // Minted locally — unlike Codex there is no provider-assigned turn id to
    // late-bind to, which is what deletes codex's whole pending-turn machinery.
    const providerTurnId = `claude-turn:${crypto.randomUUID()}`
    this.activeTurn = turn
    this.activeProviderTurnId = providerTurnId
    void turn.promise.catch(noop)
    this.ingestSession('running', input.turnId)

    try {
      const resolved = await this.resolveAttachments(input)
      // `ultrathink` reaches the model here, in the text — it is a prompt
      // keyword, and `claudeReasoning` already kept it out of `Options.effort`.
      const messageText = claudePromptText(input.messageText, this.reasoning)
      this.prompt.push(claudeUserMessage({ messageText, resolved }))
      this.emitTurnStarted(providerTurnId)
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.claude_session.send_turn.failed', {
        error,
        sessionId: this.sessionId,
        turnId: input.turnId,
      })
      this.rejectTurn(turn, providerErrorMessage(error))
      throw error
    }

    await turn.promise
    recordChatPipelineInfo('chat.pipeline.claude_session.send_turn.complete', {
      sessionId: this.sessionId,
      turnId: input.turnId,
    })
  }

  async interruptTurn(turnId: TurnId | undefined) {
    const turn = this.activeTurn
    if (!turn) {
      recordChatPipelineWarning('chat.pipeline.claude_session.interrupt.no_active_turn', {
        sessionId: this.sessionId,
        turnId,
      })
      return
    }
    if (turnId && turn.canonicalTurnId !== turnId) {
      recordChatPipelineWarning('chat.pipeline.claude_session.interrupt.turn_mismatch', {
        activeTurnId: turn.canonicalTurnId,
        sessionId: this.sessionId,
        turnId,
      })
      return
    }

    recordChatPipelineInfo('chat.pipeline.claude_session.interrupt_request', {
      sessionId: this.sessionId,
      turnId: turn.canonicalTurnId,
    })
    await this.query?.interrupt()
  }

  async respondApproval(input: ProviderApprovalResponseInput) {
    const pending = this.pendingApprovals.get(input.requestId)
    if (!pending) throw createInternalError(`Unknown pending approval request: ${input.requestId}`)

    this.pendingApprovals.delete(input.requestId)
    pending.resolve(claudePermissionResult(input.decision, pending.toolInput))
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-request-resolved'),
      payload: {
        decision: input.decision,
        requestType: claudeApprovalRequestType(pending.toolName),
        resolution: { decision: input.decision },
      },
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerBindingHandle: this.providerBindingHandle(),
      requestId: input.requestId,
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      ...(this.activeTurn ? { turnId: this.activeTurn.canonicalTurnId } : {}),
      type: 'request.resolved',
    })
  }

  hasProcess() {
    return this.processes.some((process) => process.isAlive()) || !this.streamEnded
  }

  async close() {
    recordChatPipelineInfo('chat.pipeline.claude_session.close', {
      providerBindingHandle: this.providerBindingHandle(),
      sessionId: this.sessionId,
    })
    this.prompt.close()
    this.rejectAllTurns(createInternalError('Claude session stopped.'))
    this.abortController.abort()
    this.query?.close()
    await Promise.all(this.processes.map((process) => process.close()))
    if (this.pumpCompletion)
      await withClaudeTimeout(this.pumpCompletion, 5_000, 'Claude query exit was not acknowledged.')
    this.status = 'stopped'
  }

  private spawnProcess(options: Parameters<NonNullable<Options['spawnClaudeCodeProcess']>>[0]) {
    const process = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.cwd ? { ...options.env, PWD: options.cwd } : options.env,
      signal: options.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.processes.push(new ProviderProcessLifetime(process))
    return process
  }

  private providerBindingHandle() {
    return `claude:${this.sessionId}`
  }

  private attach(query: Query) {
    this.query = query
    this.streamEnded = false
    this.pumpCompletion = this.pump(query)
  }

  private async pump(query: Query) {
    try {
      for await (const message of query) {
        this.handleMessage(message)
      }
      this.handleStreamClosed(null)
    } catch (error) {
      this.handleStreamClosed(error)
    }
  }

  private handleStreamClosed(error: unknown) {
    this.streamEnded = true
    const message = error ? providerErrorMessage(error) : 'Claude session ended.'
    if (error) {
      recordChatPipelineWarning('chat.pipeline.claude_session.stream.failed', {
        error,
        sessionId: this.sessionId,
      })
    }
    if (this.status !== 'stopped') this.emitSessionExited(message, Boolean(error))
    this.status = 'stopped'
    this.prompt.close()
    this.rejectAllTurns(createInternalError(message))
  }

  private handleMessage(message: SDKMessage) {
    switch (message.type) {
      case 'system':
        this.handleSystemMessage(message)
        return
      case 'stream_event':
        this.handleStreamEvent(message)
        return
      case 'assistant':
        this.handleAssistantMessage(message)
        return
      case 'user':
        this.handleUserMessage(message)
        return
      case 'result':
        this.handleResultMessage(message)
        return
      case 'tool_progress':
        this.emitRuntimeNotification(
          'tool.progress',
          {
            elapsedSeconds: message.elapsed_time_seconds,
            toolName: message.tool_name,
            toolUseId: message.tool_use_id,
          },
          message,
        )
        return
      case 'tool_use_summary':
        this.emitRuntimeNotification(
          'tool.summary',
          {
            precedingToolUseIds: message.preceding_tool_use_ids,
            summary: message.summary,
          },
          message,
        )
        return
      case 'auth_status':
        this.emitRuntimeNotification(
          'auth.status',
          {
            error: message.error,
            isAuthenticating: message.isAuthenticating,
            output: message.output,
          },
          message,
        )
        return
      case 'rate_limit_event':
        this.emitRuntimeNotification(
          'account.rate-limits.updated',
          { rateLimits: message.rate_limit_info },
          message,
        )
        return
      // `/clear`: the CLI opened a fresh conversation inside the same session,
      // so the provider session id changes under us — codex's `session/started`.
      case 'conversation_reset':
        this.providerConversationMarker = message.new_conversation_id
        this.emitRuntimeNotification(
          'conversation.started',
          { providerConversationMarker: message.new_conversation_id },
          message,
        )
        return
      case 'prompt_suggestion':
        this.dropMessage(message, 'no composer suggestion surface')
        return
      default:
        // Exhaustiveness guard: every member of the SDK union is handled above,
        // so a new SDK release adding one fails THIS typecheck rather than
        // reaching the runtime fallback. The fallback still catches wire-only
        // messages the published types do not declare.
        message satisfies never
        this.recordUnmappedMessage(message)
    }
  }

  /**
   * `system` is a 28-subtype envelope, and a bare session start already emits
   * `hook_started`/`hook_response` several times before any model output. Every
   * subtype therefore lands on a real runtime event or is dropped on purpose:
   * the old catch-all turned that routine traffic into user-visible warning rows.
   */
  private handleSystemMessage(message: ClaudeSystemMessage) {
    switch (message.subtype) {
      case 'init':
        this.handleInitMessage(message)
        return
      case 'status':
        this.emitSessionState(message, claudeStatusState(message.status), {
          reason: `status:${message.status ?? 'active'}`,
        })
        return
      case 'session_state_changed':
        // The CLI's own turn-over signal, which is authoritative over ours.
        this.emitSessionState(message, claudeSessionState(message.state), {
          reason: `session_state:${message.state}`,
        })
        return
      // Transport-level retry heartbeat. A single 502 storm emits a dozen of
      // these; as warning rows they buried the work log, and the terminal
      // `result` reports the real failure anyway. Keep the session visibly alive
      // instead.
      case 'api_retry':
        this.emitSessionState(message, 'running', {
          reason: `api_retry:${message.attempt}/${message.max_retries}`,
        })
        return
      case 'control_request_progress':
        this.emitSessionState(message, 'running', {
          reason: `control_request:${message.status}`,
        })
        return
      case 'worker_shutting_down':
        this.emitRuntimeNotification(
          'runtime.exited',
          { exitKind: 'graceful', reason: message.reason, recoverable: true },
          message,
        )
        return
      case 'compact_boundary':
        this.emitRuntimeNotification(
          'conversation.state.changed',
          { detail: message, state: 'compacted' },
          message,
        )
        return
      case 'hook_started':
        this.emitRuntimeNotification(
          'hook.started',
          {
            hookEvent: message.hook_event,
            hookId: message.hook_id,
            hookName: message.hook_name,
          },
          message,
        )
        return
      case 'hook_progress':
        this.emitRuntimeNotification(
          'hook.progress',
          {
            hookId: message.hook_id,
            output: message.output,
            stderr: message.stderr,
            stdout: message.stdout,
          },
          message,
        )
        return
      case 'hook_response':
        this.emitRuntimeNotification(
          'hook.completed',
          {
            exitCode: message.exit_code,
            hookId: message.hook_id,
            outcome: message.outcome,
            output: message.output,
            stderr: message.stderr,
            stdout: message.stdout,
          },
          message,
        )
        return
      case 'task_started':
        this.emitRuntimeNotification(
          'task.started',
          {
            description: message.description,
            taskId: message.task_id,
            taskType: message.task_type ?? message.subagent_type,
          },
          message,
        )
        return
      case 'task_progress':
        this.emitRuntimeNotification(
          'task.progress',
          {
            description: message.description,
            lastToolName: message.last_tool_name,
            summary: message.summary,
            taskId: message.task_id,
            usage: message.usage,
          },
          message,
        )
        return
      case 'task_updated':
        this.handleTaskUpdated(message)
        return
      case 'task_notification':
        this.emitRuntimeNotification(
          'task.completed',
          {
            status: message.status,
            summary: message.summary,
            taskId: message.task_id,
            usage: message.usage,
          },
          message,
        )
        return
      case 'files_persisted':
        this.emitRuntimeNotification(
          'files.persisted',
          {
            failed: message.failed.map((entry) => ({
              error: entry.error,
              filename: entry.filename,
            })),
            files: message.files.map((file) => ({
              fileId: file.file_id,
              filename: file.filename,
            })),
          },
          message,
        )
        return
      case 'permission_denied':
        this.handlePermissionDenied(message)
        return
      // A refusal that swapped models is a reroute, exactly like codex's
      // `model/rerouted` — not a failure the user has to read about.
      case 'model_refusal_fallback':
        this.emitRuntimeNotification(
          'model.rerouted',
          {
            fromModel: message.original_model,
            reason: `refusal:${message.api_refusal_category ?? message.trigger}`,
            toModel: message.fallback_model,
          },
          message,
        )
        return
      // Nothing caught the refusal, so the user is the one who has to act on it
      // (rephrase, or pick another model). That earns a real warning row.
      case 'model_refusal_no_fallback':
        this.emitUserFacingWarning(message, message.content)
        return
      case 'mirror_error':
        this.emitRuntimeNotification(
          'runtime.error',
          {
            class: 'provider_mirror_error',
            detail: message.key,
            message: `Claude workspace mirror error: ${message.error}`,
          },
          message,
        )
        return
      case 'notification':
        this.handleNotification(message)
        return
      case 'informational':
        this.handleInformational(message)
        return
      case 'thinking_tokens':
        this.dropMessage(message, 'thinking estimates are not session token usage')
        return
      case 'background_tasks_changed':
        this.dropMessage(message, 'roster snapshot; task.* events carry per-task truth')
        return
      case 'commands_changed':
        this.dropMessage(message, 'no slash-command surface')
        return
      case 'local_command_output':
        this.dropMessage(message, 'no slash-command output surface')
        return
      case 'memory_recall':
        this.dropMessage(message, 'no memory surface')
        return
      case 'elicitation_complete':
        this.dropMessage(message, 'resolves an elicitation we never opened')
        return
      case 'plugin_install':
        this.dropMessage(message, `plugin install ${message.status}`)
        return
      default:
        message satisfies never
        this.recordUnmappedMessage(message)
    }
  }

  /**
   * The CLI patches a task in place. A terminal patch closes the task; every
   * other patch (pending/running/paused/backgrounded, a description or error
   * edit) is progress, which is the only other task event our union carries.
   */
  private handleTaskUpdated(message: ClaudeSystemMessageOf<'task_updated'>) {
    const patch = message.patch
    const terminal = claudeTerminalTaskStatus(patch.status)
    if (terminal) {
      this.emitRuntimeNotification(
        'task.completed',
        { status: terminal, summary: patch.error ?? patch.description, taskId: message.task_id },
        message,
      )
      return
    }

    this.emitRuntimeNotification(
      'task.progress',
      {
        description: patch.description ?? `Task ${patch.status ?? 'updated'}`,
        taskId: message.task_id,
      },
      message,
    )
  }

  /**
   * A denial the user was never prompted for — a permission rule, the mode, or
   * the classifier decided it. The tool item is already open from the
   * assistant's `tool_use` block, so it closes as `declined` rather than opening
   * an approval request nobody asked for.
   */
  private handlePermissionDenied(message: ClaudeSystemMessageOf<'permission_denied'>) {
    const itemType = claudeItemType(message.tool_name)
    const tool = this.inFlightTools.get(message.tool_use_id)
    this.inFlightTools.delete(message.tool_use_id)
    this.emitRuntimeNotification(
      'item.completed',
      {
        detail: message.message,
        itemType: tool?.itemType ?? itemType,
        status: 'declined',
        title: tool?.title ?? claudeToolTitle(itemType),
      },
      message,
      { itemId: message.tool_use_id },
    )
  }

  /** CLI-authored notice. Only the loud ones earn a row; the rest is chatter. */
  private handleNotification(message: ClaudeSystemMessageOf<'notification'>) {
    if (message.priority !== 'high' && message.priority !== 'immediate') {
      this.dropMessage(message, `notification priority ${message.priority}`)
      return
    }

    this.emitUserFacingWarning(message, message.text)
  }

  /**
   * `info`/`notice`/`suggestion` are transcript decoration in the CLI's own UI.
   * Only `warning` is something the user is expected to act on.
   */
  private handleInformational(message: ClaudeSystemMessageOf<'informational'>) {
    if (message.level !== 'warning') {
      this.dropMessage(message, `informational level ${message.level}`)
      return
    }

    this.emitUserFacingWarning(message, message.content)
  }

  private emitSessionState(
    message: ClaudeSystemMessage,
    state: 'ready' | 'running' | 'waiting',
    options: { reason: string },
  ) {
    this.emitRuntimeNotification(
      'runtime.state.changed',
      { detail: message, reason: options.reason, state },
      message,
    )
  }

  /** A warning the USER can act on, carrying the raw message for debugging. */
  private emitUserFacingWarning(message: SDKMessage, text: string) {
    this.emitRuntimeNotification('runtime.warning', { detail: message, message: text }, message)
  }

  /**
   * A message we understand but have no surface for. Dropping it is OUR mapping
   * decision, not something the user can act on, so it stays in `logs/*.jsonl`
   * and never becomes a work-log row.
   */
  private dropMessage(message: SDKMessage, reason: string) {
    recordChatPipelineInfo('chat.pipeline.claude_session.message.dropped', {
      messageType: message.type,
      reason,
      subtype: claudeMessageSubtype(message),
      sessionId: this.sessionId,
    })
  }

  /**
   * A message the SDK grew that this adapter has not mapped yet — again a gap
   * on our side, so it is logged loudly enough to find and fix (type, subtype,
   * field names, and the raw payload) without painting a warning row.
   */
  private recordUnmappedMessage(message: SDKMessage) {
    const record = asRecord(message)
    recordChatPipelineWarning('chat.pipeline.claude_session.message.unmapped', {
      fields: Object.keys(record),
      messageType: stringField(record, 'type'),
      payload: message,
      subtype: stringField(record, 'subtype'),
      sessionId: this.sessionId,
    })
  }

  /**
   * Arrives DURING the first turn, not at start: the CLI withholds it until a
   * prompt is pushed. So this confirms the session id we minted rather than
   * being the place it is born, and it must not knock a running turn's status
   * back to 'ready'.
   */
  private handleInitMessage(message: ClaudeSystemMessageOf<'init'>) {
    this.confirmSessionId(message.session_id)
    if (!this.activeTurn) this.status = 'ready'

    this.emitRuntimeNotification('runtime.configured', { config: asRecord(message) }, message)
  }

  private confirmSessionId(sessionId: string) {
    if (sessionId === this.sessionId) return

    const error = sessionIdentityErrors.SESSION_IDENTITY_MISMATCH()
    this.abortController.abort(error)
    this.prompt.close()
    this.rejectAllTurns(error)
    throw error
  }

  private handleStreamEvent(message: Extract<SDKMessage, { type: 'stream_event' }>) {
    // Subagent narration must not be written into the parent transcript.
    if (message.parent_tool_use_id) return
    if (!this.activeTurn) return

    const event = asRecord(message.event)
    if (stringField(event, 'type') !== 'content_block_delta') return

    const delta = asRecord(event.delta)
    const deltaType = stringField(delta, 'type') ?? ''
    const text = stringField(delta, 'text') ?? stringField(delta, 'thinking')
    if (!text) return

    this.emitRuntimeNotification(
      'content.delta',
      {
        contentIndex: numberField(event, 'index') ?? undefined,
        delta: text,
        streamKind: claudeStreamKind(deltaType),
      },
      message,
    )
  }

  private handleAssistantMessage(message: Extract<SDKMessage, { type: 'assistant' }>) {
    if (message.parent_tool_use_id) return

    const content = message.message.content
    if (!Array.isArray(content)) return

    for (const block of content) {
      this.handleAssistantBlock(asRecord(block), message)
    }
  }

  private handleAssistantBlock(block: Record<string, unknown>, message: SDKMessage) {
    const blockType = stringField(block, 'type')
    if (blockType === 'text') {
      this.emitAssistantText(stringField(block, 'text') ?? '', message)
      return
    }
    if (blockType === 'thinking') {
      this.emitThinkingProgress(stringField(block, 'thinking') ?? '', message)
      return
    }
    if (blockType === 'tool_use') {
      this.handleToolUseBlock(block, message)
    }
  }

  private emitAssistantText(text: string, message: SDKMessage) {
    if (text.length === 0) return

    this.emitRuntimeNotification(
      'item.completed',
      {
        detail: text,
        itemType: 'assistant_message',
        status: 'completed',
        title: 'Assistant message',
      },
      message,
    )
  }

  private emitThinkingProgress(thinking: string, message: SDKMessage) {
    const summary = thinking.trim()
    if (summary.length === 0) return

    this.emitRuntimeNotification(
      'task.progress',
      {
        description: summary,
        summary,
        taskId: `reasoning:${this.activeProviderTurnId ?? this.sessionId}`,
      },
      message,
    )
  }

  private handleToolUseBlock(block: Record<string, unknown>, message: SDKMessage) {
    const toolUseId = stringField(block, 'id')
    const toolName = stringField(block, 'name')
    if (!toolUseId || !toolName) return

    const toolInput = asRecord(block.input)
    const plan = claudePlanSteps(toolName, toolInput)
    if (plan) {
      this.emitRuntimeNotification('turn.plan.updated', { explanation: null, plan }, message)
      return
    }

    const itemType = claudeItemType(toolName)
    const title = claudeToolTitle(itemType)
    this.inFlightTools.set(toolUseId, { itemType, title, toolName })
    this.emitRuntimeNotification(
      'item.started',
      {
        data: block,
        detail: claudeToolSummary(toolName, toolInput),
        itemType,
        status: 'inProgress',
        title,
      },
      message,
      { itemId: toolUseId },
    )
    if (!isClaudeTaskTool(toolName)) return

    this.emitRuntimeNotification(
      'task.started',
      {
        description: claudeToolSummary(toolName, toolInput),
        taskId: toolUseId,
        taskType: toolName,
      },
      message,
      { itemId: toolUseId },
    )
  }

  private handleUserMessage(message: Extract<SDKMessage, { type: 'user' }>) {
    const content = message.message.content
    if (!Array.isArray(content)) return

    for (const entry of content) {
      const block = asRecord(entry)
      if (stringField(block, 'type') !== 'tool_result') continue

      this.emitToolResult(block, message)
    }
  }

  private emitToolResult(block: Record<string, unknown>, message: SDKMessage) {
    const toolUseId = stringField(block, 'tool_use_id')
    if (!toolUseId) return

    const tool = this.inFlightTools.get(toolUseId)
    this.inFlightTools.delete(toolUseId)
    this.emitRuntimeNotification(
      'item.completed',
      {
        data: block,
        detail: claudeToolResultText(block.content),
        itemType: tool?.itemType ?? 'dynamic_tool_call',
        status: block.is_error === true ? 'failed' : 'completed',
        title: tool?.title ?? 'Tool call',
      },
      message,
      { itemId: toolUseId },
    )
  }

  private handleResultMessage(message: Extract<SDKMessage, { type: 'result' }>) {
    this.emitRuntimeNotification(
      'conversation.token-usage.updated',
      { usage: claudeTokenUsage(message.usage) },
      message,
    )
    void this.emitContextUsage(message)

    const turn = this.activeTurn
    if (!turn) {
      recordChatPipelineWarning('chat.pipeline.claude_session.result.no_active_turn', {
        subtype: message.subtype,
        sessionId: this.sessionId,
      })
      return
    }
    if (message.subtype === 'success') {
      this.completeTurn(turn, message.usage)
      return
    }
    // An interrupt is a user action, not a failure: it must RESOLVE the turn,
    // exactly as codex resolves a turn whose status came back 'interrupted'.
    if (isInterruptedClaudeResult(message)) {
      this.interruptTurnResult(turn, message.usage)
      return
    }

    this.rejectTurn(turn, claudeResultErrorMessage(message))
  }

  private completeTurn(turn: ActiveProviderTurn, usage: unknown) {
    const completedAt = new Date().toISOString()
    recordChatPipelineInfo('chat.pipeline.claude_session.complete_turn', {
      messageId: turn.messageId,
      sessionId: this.sessionId,
      turnId: turn.canonicalTurnId,
    })
    this.emitTurnCompleted(turn, completedAt, { state: 'completed', usage })
    this.emit({
      completedAt,
      eventId: runtimeEventId('claude-assistant-complete'),
      messageId: turn.messageId,
      sessionId: this.sessionId,
      turnId: turn.canonicalTurnId,
      type: 'assistant.complete',
    })
    this.ingestSession('ready', null)
    this.resolveTurn(turn)
  }

  private interruptTurnResult(turn: ActiveProviderTurn, usage: unknown) {
    recordChatPipelineInfo('chat.pipeline.claude_session.interrupt_turn', {
      sessionId: this.sessionId,
      turnId: turn.canonicalTurnId,
    })
    this.emitTurnCompleted(turn, new Date().toISOString(), { state: 'interrupted', usage })
    this.ingestSession('ready', null)
    this.resolveTurn(turn)
  }

  private rejectTurn(turn: ActiveProviderTurn, message: string) {
    this.status = 'error'
    this.emitTurnCompleted(turn, new Date().toISOString(), {
      errorMessage: message,
      state: 'failed',
    })
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-runtime-error'),
      payload: { class: 'provider_error', message },
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerBindingHandle: this.providerBindingHandle(),
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      turnId: turn.canonicalTurnId,
      type: 'runtime.error',
    })
    this.clearActiveTurn(turn)
    turn.reject(createInternalError(message))
  }

  private resolveTurn(turn: ActiveProviderTurn) {
    this.clearActiveTurn(turn)
    turn.resolve()
  }

  private clearActiveTurn(turn: ActiveProviderTurn) {
    if (this.activeTurn !== turn) return

    this.activeTurn = null
    this.activeProviderTurnId = null
    this.inFlightTools.clear()
  }

  private rejectAllTurns(error: Error) {
    const turn = this.activeTurn
    if (!turn) return

    this.clearActiveTurn(turn)
    turn.reject(error)
  }

  private async resolveAttachments(input: ProviderTurnInput): Promise<ResolvedAttachment[]> {
    const resolved: ResolvedAttachment[] = []
    for (const attachment of input.attachments) {
      const bytes = await readAttachmentBytes({ attachment, attachmentsDir: this.attachmentsDir })
      if (bytes) {
        resolved.push({ attachment, bytes })
        continue
      }
      // No blob came back, and the two reasons need different words. An image
      // outside Claude's allowlist has nothing on disk BY CONSTRUCTION — the
      // store refuses to persist those — so it is carried through byte-less and
      // named by `claudeUnsupportedAttachments`, which is the same rule
      // `claudeUserMessage` uses to drop it. Anything else really is a lost file.
      if (isUnsupportedClaudeImage(attachment.mimeType, attachment.type)) {
        resolved.push({ attachment, bytes: EMPTY_ATTACHMENT_BYTES })
        continue
      }

      // A pruned or hand-deleted blob degrades to "image dropped", never to a
      // failed turn — the user's text still has to reach the model.
      recordChatPipelineWarning('chat.pipeline.claude_session.attachment.missing', {
        attachmentId: attachment.id,
        sessionId: this.sessionId,
        turnId: input.turnId,
      })
      this.emitRuntimeWarning(`Attachment ${attachment.name} is missing and was not sent.`)
    }
    this.warnUnsupportedAttachments(resolved)

    return resolved
  }

  private warnUnsupportedAttachments(resolved: readonly ResolvedAttachment[]) {
    const unsupported = claudeUnsupportedAttachments(resolved)
    if (unsupported.length === 0) return

    const names = unsupported.map((attachment) => attachment.name).join(', ')
    recordChatPipelineWarning('chat.pipeline.claude_session.attachment.unsupported', {
      count: unsupported.length,
      sessionId: this.sessionId,
    })
    this.emitRuntimeWarning(
      `Claude does not accept these image types, so they were dropped: ${names}.`,
    )
  }

  private canUseTool(): CanUseTool {
    return (toolName, toolInput, options) => this.handleToolPermission(toolName, toolInput, options)
  }

  /**
   * ORDER IS THE CONTRACT. `AskUserQuestion` and `ExitPlanMode` are not
   * permission questions at all — they are how the SDK hands us a clarifying
   * question and a finished plan — so they are answered here in EVERY runtime
   * mode. Short-circuiting full-access first would swallow both exactly where
   * most sessions run, leaving plan mode with no plan to approve.
   */
  private handleToolPermission(
    toolName: string,
    toolInput: Record<string, unknown>,
    options: Parameters<CanUseTool>[2],
  ): Promise<PermissionResult> {
    if (toolName === 'AskUserQuestion') return this.requestUserInput(toolInput, options)
    if (toolName === 'ExitPlanMode') return Promise.resolve(this.captureProposedPlan(toolInput))
    // Every other tool is pre-approved in full-access. The callback still runs
    // there because plan mode overrides `bypassPermissions` with `plan`.
    if (this.runtimeMode === 'full-access') {
      return Promise.resolve({ behavior: 'allow', updatedInput: toolInput })
    }

    return this.requestApproval(toolName, toolInput, options)
  }

  /**
   * The plan is captured, never executed: the SDK would otherwise leave plan
   * mode on its own and start editing. Denying parks the turn on the proposal,
   * which is the whole point of plan mode.
   */
  private captureProposedPlan(toolInput: Record<string, unknown>): PermissionResult {
    const planMarkdown = claudeExitPlanMarkdown(toolInput)
    recordChatPipelineInfo('chat.pipeline.claude_session.proposed_plan.captured', {
      interactionMode: this.interactionMode,
      planLength: planMarkdown?.length ?? 0,
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      turnId: this.activeTurn?.canonicalTurnId,
    })
    if (planMarkdown) this.emitProposedPlan(planMarkdown)

    return {
      behavior: 'deny',
      message:
        'The client captured your proposed plan. Stop here and wait for the user to accept it or ask for changes.',
    }
  }

  private emitProposedPlan(planMarkdown: string) {
    const createdAt = new Date().toISOString()
    this.emit({
      createdAt,
      eventId: runtimeEventId('claude-proposed-plan'),
      planMarkdown,
      sessionId: this.sessionId,
      turnId: this.activeTurn?.canonicalTurnId ?? null,
      type: 'proposed-plan.upsert',
      updatedAt: createdAt,
    })
  }

  /**
   * `AskUserQuestion` blocks the tool call until the user answers, so the
   * pending entry holds the SDK's `resolve` the same way an approval does — the
   * answers come back through `respondUserInput` as this tool's result.
   */
  private requestUserInput(
    toolInput: Record<string, unknown>,
    options: Parameters<CanUseTool>[2],
  ): Promise<PermissionResult> {
    const questions = claudeUserInputQuestions(toolInput)
    recordChatPipelineInfo('chat.pipeline.claude_session.user_input.requested', {
      questionCount: questions.length,
      sessionId: this.sessionId,
      turnId: this.activeTurn?.canonicalTurnId,
    })
    // Nothing renderable means nothing to answer; denying tells Claude to ask in
    // prose instead of leaving the turn parked on a panel that cannot open.
    if (questions.length === 0) {
      return Promise.resolve({
        behavior: 'deny',
        message: 'No answerable question was provided, so nothing was asked. Ask in prose instead.',
      })
    }

    const requestId = v.parse(approvalRequestIdSchema, `claude:${crypto.randomUUID()}`)
    return new Promise<PermissionResult>((resolve) => {
      this.pendingUserInputs.set(requestId, { resolve, toolInput })
      options.signal.addEventListener('abort', () => this.abortUserInput(requestId), { once: true })
      this.emitUserInputRequested(requestId, questions, toolInput, options.toolUseID)
    })
  }

  async respondUserInput(input: ProviderUserInputResponseInput) {
    const pending = this.pendingUserInputs.get(input.requestId)
    if (!pending) {
      throw createInternalError(`Unknown pending user-input request: ${input.requestId}`)
    }

    this.pendingUserInputs.delete(input.requestId)
    // The SDK reads the answers off `updatedInput`, keyed by question text, and
    // wants the questions echoed back beside them.
    pending.resolve({
      behavior: 'allow',
      updatedInput: {
        answers: claudeUserInputAnswers(input.answers),
        questions: pending.toolInput.questions,
      },
    })
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-user-input-resolved'),
      payload: { answers: input.answers },
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerBindingHandle: this.providerBindingHandle(),
      requestId: input.requestId,
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      ...(this.activeTurn ? { turnId: this.activeTurn.canonicalTurnId } : {}),
      type: 'user-input.resolved',
    })
  }

  private abortUserInput(requestId: ApprovalRequestId) {
    const pending = this.pendingUserInputs.get(requestId)
    if (!pending) return

    this.pendingUserInputs.delete(requestId)
    pending.resolve({ behavior: 'deny', message: 'The question was cancelled by the user.' })
  }

  private emitUserInputRequested(
    requestId: ApprovalRequestId,
    questions: UserInputQuestions,
    toolInput: Record<string, unknown>,
    toolUseId: string | undefined,
  ) {
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-user-input-requested'),
      ...(toolUseId ? { itemId: toolUseId } : {}),
      payload: { questions },
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerRefs: {
        ...(toolUseId ? { providerItemId: toolUseId } : {}),
        providerRequestId: requestId,
        ...(this.activeProviderTurnId ? { providerTurnId: this.activeProviderTurnId } : {}),
      },
      providerBindingHandle: this.providerBindingHandle(),
      raw: {
        method: 'canUseTool/AskUserQuestion',
        payload: toolInput,
        source: 'claude.sdk.permission',
      },
      requestId,
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      ...(this.activeTurn ? { turnId: this.activeTurn.canonicalTurnId } : {}),
      type: 'user-input.requested',
    })
  }

  private requestApproval(
    toolName: string,
    toolInput: Record<string, unknown>,
    options: Parameters<CanUseTool>[2],
  ): Promise<PermissionResult> {
    const requestId = v.parse(approvalRequestIdSchema, `claude:${crypto.randomUUID()}`)

    return new Promise<PermissionResult>((resolve) => {
      this.pendingApprovals.set(requestId, { resolve, toolInput, toolName })
      options.signal.addEventListener('abort', () => this.abortApproval(requestId), { once: true })
      this.emitApprovalOpened(requestId, toolName, toolInput)
    })
  }

  private abortApproval(requestId: ApprovalRequestId) {
    const pending = this.pendingApprovals.get(requestId)
    if (!pending) return

    this.pendingApprovals.delete(requestId)
    pending.resolve({ behavior: 'deny', message: 'Claude tool approval was aborted.' })
  }

  private emitApprovalOpened(
    requestId: ApprovalRequestId,
    toolName: string,
    toolInput: Record<string, unknown>,
  ) {
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-request-opened'),
      payload: {
        args: toolInput,
        detail: claudeToolSummary(toolName, toolInput),
        requestType: claudeApprovalRequestType(toolName),
      },
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerRefs: {
        providerRequestId: requestId,
        ...(this.activeProviderTurnId ? { providerTurnId: this.activeProviderTurnId } : {}),
      },
      providerBindingHandle: this.providerBindingHandle(),
      raw: {
        method: `canUseTool/${toolName}`,
        payload: toolInput,
        source: 'claude.sdk.permission',
      },
      requestId,
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      ...(this.activeTurn ? { turnId: this.activeTurn.canonicalTurnId } : {}),
      type: 'request.opened',
    })
  }

  private emitSessionStarted() {
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-session-started'),
      payload: {},
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerName: DEFAULT_CLAUDE_PROVIDER_SETTINGS.displayLabel,
      providerBindingHandle: this.providerBindingHandle(),
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      type: 'runtime.started',
    })
  }

  private emitConversationStarted() {
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-session-started'),
      payload: { providerConversationMarker: this.sessionId },
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerName: DEFAULT_CLAUDE_PROVIDER_SETTINGS.displayLabel,
      providerBindingHandle: this.providerBindingHandle(),
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      type: 'conversation.started',
    })
  }

  private emitSessionExited(reason: string, failed: boolean) {
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-session-exited'),
      payload: { exitKind: failed ? 'error' : 'graceful', reason, recoverable: true },
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerBindingHandle: this.providerBindingHandle(),
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      type: 'runtime.exited',
    })
  }

  private emitTurnStarted(providerTurnId: string) {
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-turn-started'),
      payload: { model: this.model },
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerRefs: { providerTurnId },
      providerBindingHandle: this.providerBindingHandle(),
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      ...(this.activeTurn ? { turnId: this.activeTurn.canonicalTurnId } : {}),
      type: 'turn.started',
    })
  }

  private emitTurnCompleted(
    turn: ActiveProviderTurn,
    createdAt: string,
    payload: {
      errorMessage?: string
      state: 'completed' | 'failed' | 'interrupted'
      usage?: unknown
    },
  ) {
    this.emit({
      createdAt,
      eventId: runtimeEventId('claude-turn-completed'),
      payload,
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      ...(this.activeProviderTurnId
        ? { providerRefs: { providerTurnId: this.activeProviderTurnId } }
        : {}),
      providerBindingHandle: this.providerBindingHandle(),
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      turnId: turn.canonicalTurnId,
      type: 'turn.completed',
    })
  }

  private emitRuntimeWarning(message: string) {
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-runtime-warning'),
      payload: { message },
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerBindingHandle: this.providerBindingHandle(),
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      ...(this.activeTurn ? { turnId: this.activeTurn.canonicalTurnId } : {}),
      type: 'runtime.warning',
    })
  }

  private ingestSession(status: 'running' | 'ready', turnId: TurnId | null) {
    this.status = status
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-session'),
      payload: { state: status },
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerName: DEFAULT_CLAUDE_PROVIDER_SETTINGS.displayLabel,
      providerBindingHandle: this.providerBindingHandle(),
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      ...(turnId ? { turnId } : {}),
      type: 'runtime.state.changed',
    })
  }

  /**
   * Codex's `emitRuntimeNotification` envelope, with the Claude raw source.
   * Generic in `type` so every mapping below is checked against the payload the
   * event union actually declares — an untyped `payload: unknown` would let a
   * 28-subtype mapping table drift silently.
   */
  /**
   * A result message reports the tokens that turn cost, not how full the window is —
   * it carries no window size at all, so the context gauge has nothing to divide by.
   * `getContextUsage` is the only source of that number, and it is a control request:
   * asynchronous, streaming-input only, and unavailable once the session is gone.
   * So the per-turn usage goes out immediately and this follows when it can.
   */
  private async emitContextUsage(message: SDKMessage) {
    const query = this.query
    if (!query) return

    try {
      const context = await query.getContextUsage()
      this.emitRuntimeNotification(
        'conversation.token-usage.updated',
        {
          usage: {
            compactsAutomatically: true,
            maxTokens: context.maxTokens,
            usedTokens: context.totalTokens,
          },
        },
        message,
      )
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.claude_session.context_usage.failed', {
        error,
        sessionId: this.sessionId,
      })
    }
  }

  private emitRuntimeNotification<Type extends ProviderRuntimeEvent['type']>(
    type: Type,
    payload: ClaudeRuntimeEventPayload<Type>,
    message: SDKMessage,
    options: { itemId?: string } = {},
  ) {
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId(`claude-${type}`),
      ...(options.itemId ? { itemId: options.itemId } : {}),
      payload,
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerRefs: {
        ...(options.itemId ? { providerItemId: options.itemId } : {}),
        ...(this.activeProviderTurnId ? { providerTurnId: this.activeProviderTurnId } : {}),
      },
      providerBindingHandle: this.providerBindingHandle(),
      raw: { messageType: message.type, payload: message, source: 'claude.sdk.message' },
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      ...(this.activeTurn ? { turnId: this.activeTurn.canonicalTurnId } : {}),
      type,
    } as ProviderRuntimeEvent)
  }
}

/**
 * Streaming-input prompt channel. `query()` accepts a plain string, but doing so
 * disables `interrupt()` and `setModel()` with no error — so the prompt is
 * always this queue.
 */
class ClaudePromptQueue implements AsyncIterable<SDKUserMessage> {
  private readonly queue: SDKUserMessage[] = []
  private readonly waiters: Array<() => void> = []
  private closed = false

  push(message: SDKUserMessage) {
    if (this.closed) throw createInternalError('Claude prompt queue is closed.')

    this.queue.push(message)
    this.waiters.shift()?.()
  }

  close() {
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.()
    }
  }

  async *[Symbol.asyncIterator]() {
    for (;;) {
      const next = this.queue.shift()
      if (next) {
        yield next
        continue
      }
      if (this.closed) return

      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
      })
    }
  }
}

function defaultClaudeCreateQuery(input: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) {
  return claudeSdkQuery(input)
}

/**
 * Capability probe. The prompt generator NEVER yields, so the CLI completes its
 * local initialization IPC — returning account and auth state — without ever
 * sending a request to Anthropic or burning a turn. We read init, then abort.
 */
async function probeClaudeAccount(
  createQuery: ClaudeCreateQuery,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  const abortController = new AbortController()
  const query = createQuery({
    options: claudeProbeOptions(abortController, env),
    prompt: neverYieldingPrompt(abortController.signal),
  })

  try {
    const initialization = await withClaudeTimeout(
      query.initializationResult(),
      CLAUDE_INIT_TIMEOUT_MS,
      'Claude capability probe timed out.',
    )

    return initialization.account
  } finally {
    abortController.abort()
  }
}

/**
 * The same never-yielding probe, run with the project's `cwd` so project-level
 * commands and skills are discovered too. `initialize` already answers with the
 * command list; `reload_skills` is the only control request that answers with
 * skill metadata, and a CLI too old to know it leaves the skill list empty
 * rather than failing the whole read.
 */
async function probeClaudeCommandCatalog(
  createQuery: ClaudeCreateQuery,
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
): Promise<ProviderCommandCatalogResult> {
  const abortController = new AbortController()
  const query = createQuery({
    options: { ...claudeProbeOptions(abortController, env), ...(cwd ? { cwd } : {}) },
    prompt: neverYieldingPrompt(abortController.signal),
  })

  try {
    const initialization = await withClaudeTimeout(
      query.initializationResult(),
      CLAUDE_INIT_TIMEOUT_MS,
      'Claude command catalog probe timed out.',
    )

    return {
      commands: claudeSlashCommands(initialization.commands),
      skills: await claudeSkills(query),
    }
  } finally {
    abortController.abort()
  }
}

async function claudeSkills(query: Query): Promise<ProviderSkill[]> {
  if (typeof query.reloadSkills !== 'function') return []

  const reloaded = await withClaudeTimeout(
    query.reloadSkills(),
    CLAUDE_INIT_TIMEOUT_MS,
    'Claude skill list timed out.',
  )

  return namedClaudeEntries(reloaded.skills).map(claudeSkill)
}

function claudeSlashCommands(commands: readonly SlashCommand[] | undefined) {
  return namedClaudeEntries(commands).map(claudeSlashCommand)
}

/** A blank name would fail the contract and take the whole catalog with it. */
function namedClaudeEntries(entries: readonly SlashCommand[] | undefined) {
  return (entries ?? []).filter((entry) => entry.name.trim().length > 0)
}

function claudeSlashCommand(command: SlashCommand): ProviderSlashCommand {
  const description = claudeText(command.description)
  const argumentHint = claudeText(command.argumentHint)
  const aliases = (command.aliases ?? []).map((alias) => alias.trim()).filter(Boolean)

  return {
    name: command.name.trim(),
    ...(description ? { description } : {}),
    ...(argumentHint ? { argumentHint } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
  }
}

/** The CLI only reports skills it actually loaded, so a listed skill is enabled. */
function claudeSkill(skill: SlashCommand): ProviderSkill {
  const description = claudeText(skill.description)
  const name = skill.name.trim()
  const scope = claudeSkillScope(name)

  return {
    enabled: true,
    name,
    ...(description ? { description } : {}),
    ...(scope ? { scope } : {}),
  }
}

/** `plugin:skill` names carry their origin in the prefix; bare names have none. */
function claudeSkillScope(name: string) {
  const separator = name.lastIndexOf(':')

  return separator > 0 ? name.slice(0, separator) : null
}

/** Blank provider copy must never reach a trimmed-non-empty contract field. */
function claudeText(value: string | undefined) {
  const trimmed = value?.trim()

  return trimmed ? trimmed : null
}

function claudeProbeOptions(abortController: AbortController, env: NodeJS.ProcessEnv): Options {
  return {
    abortController,
    // MCP must be neutralized or the health check becomes heavyweight and flaky.
    // The first three cover filesystem-configured servers; claude.ai connectors
    // are discovered outside filesystem config and need the env flag as well.
    allowedTools: [],
    env: { ...env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
    mcpServers: {},
    persistSession: false,
    settingSources: ['user', 'project', 'local'],
    stderr: noop,
    strictMcpConfig: true,
  }
}

// oxlint-disable-next-line require-yield
async function* neverYieldingPrompt(signal: AbortSignal): AsyncGenerator<SDKUserMessage> {
  await waitForAbortSignal(signal)
}

function waitForAbortSignal(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve()

  return new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

async function withClaudeTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(createInternalError(message)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

type ClaudeProviderAuthState = Pick<ProviderSnapshot, 'auth' | 'message' | 'status'>

/**
 * `claude auth status --json` decides authenticated vs not; the SDK account is
 * only decoration on top of it. The account heuristic survives as the fallback
 * for `unknown` (CLI too old to answer, or the read failed).
 */
function claudeAuthState(cli: ClaudeAuthState, account: unknown): ClaudeProviderAuthState {
  if (cli.status === 'unknown') return claudeAccountAuthState(account)
  if (cli.status === 'unauthenticated') return signedOutClaudeAuthState()

  const record = asRecord(account)
  const email = stringField(record, 'email')
  const type = claudeAccountType(cli, record)

  return {
    auth: {
      status: 'authenticated',
      ...(email ? { email } : {}),
      ...(type ? { type } : {}),
    },
    status: 'ready',
  }
}

function claudeAccountType(cli: ClaudeAuthState, record: Record<string, unknown>) {
  if (cli.apiProvider && cli.apiProvider !== 'firstParty') return cli.apiProvider

  return stringField(record, 'subscriptionType') ?? cli.authMethod
}

function claudeAccountAuthState(account: unknown): ClaudeProviderAuthState {
  const record = asRecord(account)
  const apiProvider = stringField(record, 'apiProvider')
  const email = stringField(record, 'email')
  const subscriptionType = stringField(record, 'subscriptionType')

  // `tokenSource` is the literal string 'none' when signed out, which is truthy.
  // Treating it as a presence check reports a signed-out CLI as authenticated and
  // defers the failure to mid-turn ("OAuth session expired"), where the user has
  // no way to act on it.
  const tokenSource = stringField(record, 'tokenSource')
  const hasToken = Boolean(tokenSource) && tokenSource !== 'none'

  if (apiProvider && apiProvider !== 'firstParty') {
    return { auth: { status: 'authenticated', type: apiProvider }, status: 'ready' }
  }
  if (email || subscriptionType || hasToken) {
    return {
      auth: {
        status: 'authenticated',
        ...(email ? { email } : {}),
        ...(subscriptionType ? { type: subscriptionType } : {}),
      },
      status: 'ready',
    }
  }

  return signedOutClaudeAuthState()
}

function signedOutClaudeAuthState(): ClaudeProviderAuthState {
  return {
    auth: { status: 'unauthenticated' },
    message: CLAUDE_SIGNED_OUT_MESSAGE,
    status: 'error',
  }
}

/** A missing binary is "unavailable", not "error" — mirrors `unavailableCodexSnapshot`. */
function unavailableClaudeSnapshot(
  checkedAt: string,
  settings: ProviderInstanceSettings,
): ProviderSnapshot {
  return {
    ...settings,
    auth: { status: 'unknown' },
    availability: 'unavailable',
    checkedAt,
    enabled: false,
    installed: false,
    message: 'Claude Code (`claude`) is not installed or not on PATH.',
    models: [],
    status: 'error',
    version: null,
  }
}

function isMissingClaudeBinaryError(error: unknown) {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === 'ENOENT') return true

  const message = providerErrorMessage(error).toLowerCase()
  return message.includes('enoent') || message.includes('exited with code 127')
}

function claudePermissionResult(
  decision: ProviderApprovalDecision,
  toolInput: Record<string, unknown>,
): PermissionResult {
  if (decision === 'accept' || decision === 'acceptForSession') {
    return { behavior: 'allow', updatedInput: toolInput }
  }
  if (decision === 'cancel') {
    return { behavior: 'deny', message: 'Tool use cancelled by the user.' }
  }

  return { behavior: 'deny', message: 'Tool use denied by the user.' }
}

function isUnsupportedClaudeImage(mimeType: string, attachmentType: string) {
  if (attachmentType !== 'image') return false

  return claudeImageMediaType(mimeType) === null
}

function claudeStreamKind(deltaType: string) {
  return deltaType.includes('thinking') ? ('reasoning_text' as const) : ('assistant_text' as const)
}

function claudeItemType(toolName: string) {
  const normalized = toolName.toLowerCase()
  if (normalized.startsWith('mcp__')) return 'mcp_tool_call'
  if (normalized === 'bash' || normalized.includes('command') || normalized.includes('shell')) {
    return 'command_execution'
  }
  if (normalized === 'edit' || normalized === 'write' || normalized === 'notebookedit') {
    return 'file_change'
  }
  if (normalized.includes('websearch') || normalized.includes('webfetch')) return 'web_search'
  if (normalized === 'read') return 'image_view'
  if (isClaudeTaskTool(toolName)) return 'unknown'

  return 'dynamic_tool_call'
}

function claudeToolTitle(itemType: string) {
  if (itemType === 'command_execution') return 'Command run'
  if (itemType === 'file_change') return 'File change'
  if (itemType === 'mcp_tool_call') return 'MCP tool call'
  if (itemType === 'web_search') return 'Web search'
  if (itemType === 'image_view') return 'File read'

  return 'Tool call'
}

function isClaudeTaskTool(toolName: string) {
  const normalized = toolName.toLowerCase()
  return normalized === 'task' || normalized === 'agent'
}

function claudeToolSummary(toolName: string, toolInput: Record<string, unknown>) {
  const command = stringField(toolInput, 'command') ?? stringField(toolInput, 'cmd')
  if (command) return `${toolName}: ${command.slice(0, 400)}`

  const description =
    stringField(toolInput, 'description') ?? stringField(toolInput, 'file_path') ?? null
  if (description) return `${toolName}: ${description.slice(0, 400)}`

  return toolName
}

/**
 * Everything the SDK can ask about goes through `canUseTool`, so the tool name
 * is the only signal for what the approval is really about. Anything we cannot
 * place stays `dynamic_tool_call_approval`, which ingestion maps to the generic
 * tool kind rather than dropping.
 */
function claudeApprovalRequestType(toolName: string) {
  const itemType = claudeItemType(toolName)
  if (itemType === 'command_execution') return 'command_execution_approval'
  if (itemType === 'file_change') return 'file_change_approval'
  if (itemType === 'image_view') return 'file_read_approval'
  if (itemType === 'mcp_tool_call') return 'mcp_tool_call_approval'

  return 'dynamic_tool_call_approval'
}

/**
 * `ExitPlanModeInput` is declared open (`[k: string]: unknown`) by the SDK, so
 * the markdown is read defensively off `plan` rather than typed.
 */
function claudeExitPlanMarkdown(toolInput: Record<string, unknown>) {
  return stringField(toolInput, 'plan')?.trim() ?? null
}

/** TodoWrite is Claude's plan surface; it becomes `turn.plan.updated`, not an item. */
function claudePlanSteps(toolName: string, toolInput: Record<string, unknown>) {
  if (toolName.toLowerCase() !== 'todowrite') return null

  const todos = toolInput.todos
  if (!Array.isArray(todos) || todos.length === 0) return null

  return todos.map((todo) => {
    const record = asRecord(todo)
    return {
      status: claudePlanStepStatus(stringField(record, 'status')),
      step: stringField(record, 'content') ?? 'Task',
    }
  })
}

function claudePlanStepStatus(value: string | null) {
  if (value === 'completed') return 'completed' as const
  if (value === 'in_progress') return 'inProgress' as const

  return 'pending' as const
}

function claudeToolResultText(value: unknown) {
  if (typeof value === 'string') return value.slice(0, 4000)
  if (!Array.isArray(value)) return undefined

  const text = value
    .map((entry) => stringField(asRecord(entry), 'text') ?? '')
    .filter(Boolean)
    .join('\n')

  return text.length > 0 ? text.slice(0, 4000) : undefined
}

function claudeMessageSubtype(message: SDKMessage) {
  return stringField(asRecord(message), 'subtype')
}

/** `compacting` is the CLI working with the turn parked, which is `waiting`. */
function claudeStatusState(status: 'compacting' | 'requesting' | null) {
  return status === 'compacting' ? ('waiting' as const) : ('running' as const)
}

function claudeSessionState(state: 'idle' | 'running' | 'requires_action') {
  if (state === 'running') return 'running' as const
  if (state === 'requires_action') return 'waiting' as const

  return 'ready' as const
}

/** Only these three patch statuses close a task; the rest are still in flight. */
function claudeTerminalTaskStatus(status: string | undefined) {
  if (status === 'completed') return 'completed' as const
  if (status === 'failed') return 'failed' as const
  if (status === 'killed') return 'stopped' as const

  return null
}

function claudeTokenUsage(usage: unknown) {
  const record = asRecord(usage)
  const usedTokens =
    (numberField(record, 'input_tokens') ?? 0) +
    (numberField(record, 'output_tokens') ?? 0) +
    (numberField(record, 'cache_creation_input_tokens') ?? 0) +
    (numberField(record, 'cache_read_input_tokens') ?? 0)

  return { ...record, usedTokens }
}

/**
 * The CLI stamps user aborts explicitly: interrupting mid-tool-call yields
 * `aborted_tools`, mid-stream yields `aborted_streaming`. Older CLIs only leave
 * the word in `errors`, so both are checked.
 */
function isInterruptedClaudeResult(message: Extract<SDKMessage, { type: 'result' }>) {
  if (message.terminal_reason === 'aborted_tools') return true
  if (message.terminal_reason === 'aborted_streaming') return true

  const errors = claudeResultErrors(message).join(' ').toLowerCase()
  if (errors.includes('interrupt')) return true

  return errors.includes('request was aborted')
}

function claudeResultErrors(message: Extract<SDKMessage, { type: 'result' }>) {
  if (!('errors' in message)) return []

  return Array.isArray(message.errors) ? message.errors : []
}

function claudeResultErrorMessage(message: Extract<SDKMessage, { type: 'result' }>) {
  // `[ede_diagnostic] ...` entries are CLI-internal telemetry — never the banner.
  const userFacing = claudeResultErrors(message).find(
    (error) => typeof error === 'string' && !error.startsWith('[ede_diagnostic]'),
  )

  return userFacing ?? `Claude turn failed (${message.subtype}).`
}
