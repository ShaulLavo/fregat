import { spawn } from 'node:child_process'
import { ProviderProcessLifetime } from './process-lifetime'
import { createInternalError, isEvlogError } from '../../observability/structured-errors'

import {
  query as claudeSdkQuery,
  type AccountInfo,
  type CanUseTool,
  type HookCallback,
  type ModelInfo,
  type Options,
  type PermissionResult,
  type Query,
  type SDKControlGetContextUsageResponse,
  type SDKMessage,
  type SDKRateLimitEvent,
  type SDKUserMessage,
  type AgentInfo,
  type SlashCommand,
} from '@anthropic-ai/claude-agent-sdk'
import {
  DEFAULT_CLAUDE_PROVIDER_SETTINGS,
  DEFAULT_INTERACTION_MODE,
  approvalRequestIdSchema,
  messageIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type ApprovalRequestId,
  type InteractionMode,
  type ProviderApprovalOption,
  type ProviderInstanceId,
  type ProviderInstanceSettings,
  type ProviderAgent,
  type ProviderSkill,
  type ProviderSlashCommand,
  type ProviderMcpServer,
  type ProviderSnapshot,
  type ProviderTurnOrigin,
  type RuntimeMode,
  type SessionId,
  type TurnEndReason,
  type TurnId,
  type UserInputQuestions,
} from '@workspace/contracts'
import * as v from 'valibot'
import {
  attachmentFilePath,
  defaultAttachmentsDir,
  readAttachmentBytes,
} from '../../attachments/store'
import {
  providerTurnSummary,
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from '../../orchestration/orchestration-logging'
import { RuntimeAdapter } from './state/runtime-adapter'
import { SessionContext } from './state/session-context'
import { isNotInstalledError, requestGone, sessionIdentityErrors } from '../structured-errors'
import {
  discoverClaudeSessions,
  readClaudeSessionHistory,
  readClaudeSessionUsage,
  type ClaudeDiscoveryRunner,
  type ClaudeHistoryRunner,
} from '../claude-discovery'
import type {
  ProviderAdapter,
  ProviderAdapterRuntime,
  ProviderApprovalResponseInput,
  ProviderCommandCatalogInput,
  ProviderCommandCatalogResult,
  ProviderForkStart,
  ProviderHookOutcome,
  ProviderRuntimeEvent,
  ProviderRuntimeStartInput,
  ProviderSessionDiscoveryInput,
  ProviderSessionHistoryInput,
  ProviderForkInput,
  ProviderSignInInput,
  ProviderTurnInput,
  ProviderUserInputResponseInput,
} from '../types'
import { claudeForkPoint } from './utils/claude-fork'
import { activeProviderTurn, type ActiveProviderTurn } from './utils/active-turn'
import { errorMessage as providerErrorMessage } from '@workspace/contracts'
import {
  ClaudeAuthRunner,
  type ClaudeAuthState,
  type ClaudeLoginAttempt,
} from './utils/claude-auth'
import { resolveClaudeExecutable, type ClaudeExecutable } from './utils/claude-executable'
import { claudeCatalog, type ClaudeCatalog } from './utils/claude-models'
import { claudeUsageTotals } from '../utils/usage-totals'
import {
  claudeBlocksTurn,
  claudeEventWindow,
  claudeUsageProbe,
  claudeUsageUpdate,
  usageLimitMessage,
  type ProviderUsageProbe,
} from '../utils/usage-windows'
import { offeredOptions, offeredResponse, type ApprovalOffer } from './utils/approval-offers'
import { claudeApprovalOffers, claudePermissionUpdateCount } from './utils/claude-permissions'
import {
  claudeModelId,
  claudeQueryOptions,
  type ClaudeForkOptions,
} from './utils/claude-query-options'
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
// The usage route waits on this probe, so it gives up well before the capability probe does.
const CLAUDE_USAGE_INIT_TIMEOUT_MS = 10_000
const CLAUDE_USAGE_TIMEOUT_MS = 4_000

/** Placeholder payload for an attachment that is guaranteed to be dropped. */
const EMPTY_ATTACHMENT_BYTES = new Uint8Array(0)

export const CLAUDE_ADAPTER_CAPABILITIES = {
  conversationRollback: false,
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
  /** Settings-level CLI path; empty resolves the installed or bundled `claude`. */
  binaryPath?: string
  createQuery?: ClaudeCreateQuery
  displayLabel?: string
  enabled?: boolean
  /**
   * Per-instance spawn env. Isolation rides on `CLAUDE_CONFIG_DIR`, never on
   * `HOME` — see `claudeQueryOptions` for why.
   */
  env?: NodeJS.ProcessEnv
  providerInstanceId?: ProviderInstanceId
  /** Replaces executable resolution, which runs `claude --version`. */
  resolveExecutable?: () => Promise<ClaudeExecutable>
}

type ClaudeInitialization = {
  account: AccountInfo | undefined
  catalog: ClaudeCatalog
}

type PendingClaudeApproval = {
  offers: readonly ApprovalOffer<PermissionResult>[]
  resolve: (result: PermissionResult) => void
  toolName: string
}

/** `toolInput` is kept because the SDK wants the questions echoed back beside the answers. */
type PendingClaudeUserInput = {
  resolve: (result: PermissionResult) => void
  toolInput: Record<string, unknown>
}

type PendingClaudeTurn = {
  providerTurnId: string
  turn: ActiveProviderTurn
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

export class ClaudeProviderAdapter
  extends RuntimeAdapter<ClaudeAgentSession>
  implements ProviderAdapter
{
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
  private readonly settings: ProviderInstanceSettings
  private readonly resolveExecutable: () => Promise<ClaudeExecutable>
  /** One resolution per instance; a `binaryPath` change recreates the instance. */
  private executablePromise: Promise<ClaudeExecutable> | null = null
  /** The newest non-empty catalog; sessions read capabilities from it. */
  private catalog: ClaudeCatalog | null = null
  private initializationProbe: Promise<ClaudeInitialization> | null = null
  /** The overage-included bucket's model, learned from `get_usage`; the stream never names it. */
  private scopedUsageModel: string | null = null

  /**
   * `createQuery` is the seam every test depends on: without it each test spawns
   * the real `claude` binary and talks to a real account. It covers `snapshot()`
   * as well as `sendTurn` — the capability probe is the call that spawns a
   * process, so injecting only the turn path would leave the binary reachable.
   * `auth` is the same idea for the CLI-level `claude auth …` commands, where an
   * un-injected `signIn` would open a real browser window.
   */
  constructor(options: ClaudeAdapterOptions = {}) {
    super('Claude', 'session')
    this.adapterKey =
      options.providerInstanceId ?? DEFAULT_CLAUDE_PROVIDER_SETTINGS.providerInstanceId
    this.attachmentsDir = options.attachmentsDir ?? defaultAttachmentsDir()
    this.env = options.env ?? process.env
    const env = this.env
    this.resolveExecutable =
      options.resolveExecutable ??
      (() => resolveClaudeExecutable({ binaryPath: options.binaryPath, env }))
    this.auth =
      options.auth ?? new ClaudeAuthRunner({ command: () => this.executablePath(), env: this.env })
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
      const executable = await this.executable()
      const { catalog, state } = await this.readAuthState()
      recordChatPipelineInfo('chat.pipeline.claude_adapter.snapshot.complete', {
        authStatus: state.auth.status,
        cliVersion: executable.version,
        defaultFallback: catalog.defaultFallback,
        defaultModel: catalog.defaultModel,
        executableSource: executable.source,
        installed: true,
        modelCount: catalog.models.length,
        status: state.status,
      })

      return {
        ...this.settings,
        auth: state.auth,
        checkedAt,
        installed: true,
        models: catalog.models,
        status: state.status,
        supportsSignIn: true,
        version: executable.version,
        ...(state.message ? { message: state.message } : {}),
      }
    } catch (error) {
      if (isNotInstalledError(error)) return unavailableClaudeSnapshot(checkedAt, this.settings)

      recordChatPipelineWarning('chat.pipeline.claude_adapter.snapshot.failed', {
        error,
        providerInstanceId: this.adapterKey,
      })
      return {
        ...this.settings,
        auth: { status: 'unknown' },
        checkedAt,
        installed: true,
        message: claudeSnapshotErrorMessage(error),
        models: [],
        status: 'error',
        supportsSignIn: true,
        version: null,
      }
    }
  }

  async authStatus() {
    const { state } = await this.readAuthState()
    return state.auth
  }

  /** The CLI every spawn of this instance runs, terminal resume included. */
  async executablePath() {
    const executable = await this.executable()
    return executable.path
  }

  forgetExecutable() {
    this.executablePromise = null
  }

  /**
   * Reuses the capability probe: the same never-yielding prompt that reads
   * account state also carries the command list, and the skill list is one more
   * control request on the already-running CLI. No turn is spent either way.
   */
  async listCommands({ cwd }: ProviderCommandCatalogInput) {
    return probeClaudeCommandCatalog(
      this.createQuery,
      this.env,
      await this.executablePath(),
      cwd ? normalizeWorkspaceCwd(cwd) : undefined,
    )
  }

  async readUsage(): Promise<ProviderUsageProbe> {
    const response = await probeClaudeUsage(this.createQuery, this.env, await this.executablePath())
    const { probe, scopedModel } = claudeUsageProbe(response)
    if (probe.kind === 'reading') this.scopedUsageModel = scopedModel

    return probe
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
    const [cli, initialization] = await Promise.all([
      this.auth.status(),
      this.probeInitialization(),
    ])

    return {
      catalog: initialization.catalog,
      state: claudeAuthState(cli, initialization.account),
    }
  }

  private executable() {
    this.executablePromise ??= this.resolveExecutable().catch((error: unknown) => {
      // A configured binary installed later must not need a restart to be found.
      this.executablePromise = null
      throw error
    })

    return this.executablePromise
  }

  /** Shared by concurrent callers, so a session start rides the snapshot's probe. */
  private probeInitialization() {
    this.initializationProbe ??= this.readInitialization().finally(() => {
      this.initializationProbe = null
    })

    return this.initializationProbe
  }

  private async readInitialization(): Promise<ClaudeInitialization> {
    const initialization = await probeClaudeInitialization(
      this.createQuery,
      this.env,
      await this.executablePath(),
    )
    const catalog = claudeCatalog(initialization.models)
    if (catalog.models.length > 0) this.catalog = catalog

    return { account: initialization.account, catalog }
  }

  private async currentCatalog() {
    if (this.catalog) return this.catalog

    const initialization = await this.probeInitialization()
    return initialization.catalog
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

  readSessionUsage(request: ProviderSessionHistoryInput) {
    return readClaudeSessionUsage({ request, env: this.env, runner: this.historyRunner })
  }

  async hasRuntime({ sessionId }: { sessionId: SessionId }) {
    return this.sessions.get(sessionId)?.hasProcess() ?? false
  }

  async prepareRollbackSession(): Promise<never> {
    throw createInternalError('Claude prepareRollbackSession is not supported.')
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

  async mcpServers({ sessionId }: { sessionId: SessionId }) {
    return (await this.sessions.get(sessionId)?.mcpServers()) ?? null
  }

  async reconnectMcpServer({ name, sessionId }: { name: string; sessionId: SessionId }) {
    recordChatPipelineInfo('chat.pipeline.claude_adapter.mcp_reconnect', { name, sessionId })
    const session = this.sessions.get(sessionId)
    if (!session) throw sessionIdentityErrors.SESSION_NOT_RUNNING({ internal: { sessionId } })

    await session.reconnectMcpServer(name)
  }

  async stopBackgroundTask({ sessionId, taskId }: { sessionId: SessionId; taskId: string }) {
    recordChatPipelineInfo('chat.pipeline.claude_adapter.stop_task', { sessionId, taskId })
    const session = this.sessions.get(sessionId)
    if (!session) throw sessionIdentityErrors.SESSION_NOT_RUNNING({ internal: { sessionId } })

    await session.stopBackgroundTask(taskId)
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

  async prepareFork(input: ProviderForkInput): Promise<ProviderForkStart> {
    const history = await this.readSessionHistory({
      ...input,
      sessionId: v.parse(sessionIdSchema, input.conversationId),
    })
    return { boundaryId: claudeForkPoint(history, input), conversationId: input.conversationId }
  }

  protected async ensureRuntimeSession(input: ProviderRuntimeStartInput) {
    const existing = this.sessions.get(input.sessionId)
    const cwd = normalizeWorkspaceCwd(input.cwd)
    const catalog = await this.currentCatalog()
    const model = claudeModelId({
      catalog,
      modelSelection: input.modelSelection,
      providerInstanceId: input.providerInstanceId,
    })
    // Effort and thinking are baked into the query options at spawn time, so
    // they join cwd/model/runtimeMode in the reuse check: a session that switched
    // level has to get a new query, not a stale one that ignores it.
    const reasoning = claudeReasoning({
      catalog,
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
      agent: input.agent,
      forked: Boolean(input.fork),
      interactionMode,
      model,
      providerInstanceId: input.providerInstanceId,
      reasoning,
      runtimeMode: input.runtimeMode,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
    })
    const fork = input.fork
      ? {
          resumeSessionAt: input.fork.boundaryId,
          sourceSessionId: v.parse(sessionIdSchema, input.fork.conversationId),
        }
      : undefined
    const session = await ClaudeAgentSession.start({
      ...(input.agent ? { agent: input.agent } : {}),
      fork,
      onCreated: (session) => this.sessions.set(input.sessionId, session),
      attachmentsDir: this.attachmentsDir,
      createQuery: this.createQuery,
      cwd,
      emit: (event) => this.events.publish(event),
      env: this.env,
      ephemeral,
      executablePath: await this.executablePath(),
      interactionMode,
      model,
      providerInstanceId: input.providerInstanceId,
      reasoning,
      resumeExisting: input.resumeExisting,
      runtimeMode: input.runtimeMode,
      runtimeEpoch: input.runtimeEpoch,
      scopedUsageModel: () => this.scopedUsageModel,
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
}

class ClaudeAgentSession extends SessionContext {
  private readonly abortController = new AbortController()
  private readonly attachmentsDir: string
  private readonly taskTypes = new Map<string, string>()
  private readonly inFlightTools = new Map<string, InFlightClaudeTool>()
  private readonly interactionMode: InteractionMode
  private readonly pendingApprovals = new Map<ApprovalRequestId, PendingClaudeApproval>()
  private readonly pendingUserInputs = new Map<ApprovalRequestId, PendingClaudeUserInput>()
  private readonly prompt = new ClaudePromptQueue()
  private readonly reasoning: ClaudeReasoning
  private readonly reasoningKey: string
  private providerConversationMarker: string | null = null
  private activeProviderTurnId: string | null = null
  private activeTurn: ActiveProviderTurn | null = null
  /** Set while the running turn is one the harness started; null for the owner's own turn. */
  private activeOrigin: ProviderTurnOrigin | null = null
  /** The owner's prompt, queued in the harness behind a harness turn until its lifecycle starts. */
  private pendingTurn: PendingClaudeTurn | null = null
  /** The owner's running turn, pushed and queued (`command_lifecycle`), but not yet started. */
  private activeAwaitingStart = false
  /** A harness turn ran ahead of the owner's queued prompt; its `result` is not the owner's. */
  private foreignResultsBeforeStart = 0
  /** What the next harness turn is about, learned before it starts. */
  private nextHarnessOrigin: ProviderTurnOrigin | null = null
  /** This CLI reports `command_lifecycle`, so an owner turn is running only once its own frame says so. */
  private lifecycleReported = false
  private query: Query | null = null
  private pumpCompletion: Promise<void> | null = null
  private streamEnded = true
  private readonly processes: ProviderProcessLifetime[] = []
  private status: ProviderAdapterRuntime['status'] = 'starting'
  /** `type:resetsAt` of the limit stops this turn has already announced. */
  private readonly announcedLimitStops = new Set<string>()
  private readonly scopedUsageModel: () => string | null
  private readonly resumed: boolean

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
    resumeExisting?: boolean
    runtimeEpoch: string
    scopedUsageModel: () => string | null
    sessionId: SessionId
  }) {
    super(input)
    this.resumed = input.resumeExisting === true
    this.attachmentsDir = input.attachmentsDir
    this.scopedUsageModel = input.scopedUsageModel
    this.interactionMode = input.interactionMode
    this.reasoning = input.reasoning
    this.reasoningKey = claudeReasoningKey(input.reasoning)
  }

  // Streaming input withholds init until the first prompt; adopt the caller's UUID before it.
  static async start(input: {
    agent?: string
    fork?: ClaudeForkOptions
    onCreated: (session: ClaudeAgentSession) => void
    attachmentsDir: string
    createQuery: ClaudeCreateQuery
    cwd: string
    emit: (event: ProviderRuntimeEvent) => void
    env: NodeJS.ProcessEnv
    ephemeral: boolean
    executablePath: string
    interactionMode: InteractionMode
    model: string
    providerInstanceId: ProviderTurnInput['providerInstanceId']
    reasoning: ClaudeReasoning
    resumeExisting?: boolean
    runtimeMode: RuntimeMode
    runtimeEpoch: string
    scopedUsageModel: () => string | null
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
      ...(input.ephemeral ? {} : { hooks: { Stop: [{ hooks: [session.stopHook()] }] } }),
      env: input.env,
      executablePath: input.executablePath,
      ...(input.agent ? { agent: input.agent } : {}),
      fork: input.fork,
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
   * One owner turn at a time, enforced. `SDKResultMessage` carries no turn identifier, so a
   * result settles whichever turn is running; the prompt's uuid and its `command_lifecycle`
   * frames say which one that is. A turn the harness starts on its own (a wakeup, a finished
   * background task) runs as its own turn, and a prompt sent during it waits for its own start.
   */
  async sendTurn({ input, messageId }: { input: ProviderTurnInput; messageId: string }) {
    if ((this.activeTurn && this.activeOrigin === null) || this.pendingTurn) {
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
    // Minted locally and stamped on the prompt: `command_lifecycle` frames report
    // it as queued, started and completed, which is how this turn is told apart
    // from a turn the harness starts on its own (a wakeup, a finished task).
    const providerTurnId = crypto.randomUUID()
    void turn.promise.catch(noop)
    // Behind a harness turn the prompt waits in the harness queue; it starts when its lifecycle does.
    const queued = this.activeTurn !== null
    if (queued) this.pendingTurn = { providerTurnId, turn }
    if (!queued) this.beginOwnTurn(turn, providerTurnId)

    try {
      const resolved = await this.resolveAttachments(input)
      // `ultrathink` reaches the model here, in the text — it is a prompt
      // keyword, and `claudeReasoning` already kept it out of `Options.effort`.
      const messageText = claudePromptText(input.messageText, this.reasoning)
      this.prompt.push({ ...claudeUserMessage({ messageText, resolved }), uuid: providerTurnId })
      if (!queued) this.emitTurnStarted(providerTurnId)
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.claude_session.send_turn.failed', {
        error,
        sessionId: this.sessionId,
        turnId: input.turnId,
      })
      if (this.pendingTurn?.turn === turn) this.pendingTurn = null
      this.rejectTurn(turn, providerErrorMessage(error))
      throw error
    }

    await turn.promise
    recordChatPipelineInfo('chat.pipeline.claude_session.send_turn.complete', {
      sessionId: this.sessionId,
      turnId: input.turnId,
    })
  }

  private beginOwnTurn(turn: ActiveProviderTurn, providerTurnId: string) {
    this.activeTurn = turn
    this.activeOrigin = null
    this.activeProviderTurnId = providerTurnId
    // A wakeup can fire between this push and the CLI reading it; until the prompt's own
    // `started`, any turn that runs is someone else's.
    this.activeAwaitingStart = this.lifecycleReported
    this.foreignResultsBeforeStart = 0
    this.nextHarnessOrigin = null
    this.announcedLimitStops.clear()
    this.ingestSession('running', turn.canonicalTurnId)
  }

  /** The owner's queued prompt reached the front of the harness queue. */
  private startPendingTurn() {
    const pending = this.pendingTurn
    if (!pending) return
    this.pendingTurn = null
    if (this.activeTurn) {
      recordChatPipelineWarning('chat.pipeline.claude_session.pending_turn.started_over_active', {
        activeTurnId: this.activeTurn.canonicalTurnId,
        sessionId: this.sessionId,
        turnId: pending.turn.canonicalTurnId,
      })
      this.clearActiveTurn(this.activeTurn)
    }
    this.beginOwnTurn(pending.turn, pending.providerTurnId)
    this.emitTurnStarted(pending.providerTurnId)
  }

  /** A turn no prompt of ours asked for; it gets its own turn id so its reply and result land on it. */
  private adoptHarnessTurn(origin: ProviderTurnOrigin, providerTurnId: string) {
    const turnId = v.parse(turnIdSchema, `provider:${crypto.randomUUID()}`)
    const turn = activeProviderTurn({
      canonicalTurnId: turnId,
      messageId: v.parse(messageIdSchema, `assistant:${turnId}`),
    })
    void turn.promise.catch(noop)
    this.activeTurn = turn
    this.activeOrigin = origin
    this.activeProviderTurnId = providerTurnId
    this.activeAwaitingStart = false
    this.nextHarnessOrigin = null
    this.announcedLimitStops.clear()
    recordChatPipelineInfo('chat.pipeline.claude_session.harness_turn.adopted', {
      origin,
      sessionId: this.sessionId,
      turnId,
    })
    this.emitTurnStarted(providerTurnId, origin)
    this.ingestSession('running', turnId)
  }

  /**
   * `command_lifecycle` is not in the SDK's message union, so it is read by shape.
   * `started` with a uuid we never pushed is a wakeup or cron firing.
   */
  private handleCommandLifecycle(commandUuid: string, state: string) {
    this.lifecycleReported = true
    if (state === 'queued') {
      if (this.activeProviderTurnId === commandUuid && this.activeOrigin === null) {
        this.activeAwaitingStart = true
      }
      return
    }
    if (state === 'cancelled') {
      this.cancelPendingTurn(commandUuid)
      return
    }
    if (state !== 'started') return
    if (this.pendingTurn?.providerTurnId === commandUuid) {
      this.startPendingTurn()
      return
    }
    if (this.activeProviderTurnId === commandUuid) {
      this.activeAwaitingStart = false
      return
    }
    if (!this.activeTurn) {
      this.adoptHarnessTurn(this.nextHarnessOrigin ?? 'scheduled', commandUuid)
      return
    }
    // The harness ran its own turn ahead of the owner's queued prompt: that turn's output
    // lands on the owner's turn, and its result must not close it.
    if (this.activeOrigin === null && this.activeAwaitingStart) this.foreignResultsBeforeStart += 1
  }

  private cancelPendingTurn(commandUuid: string) {
    const pending = this.pendingTurn
    if (pending?.providerTurnId !== commandUuid) return

    this.pendingTurn = null
    this.emitTurnCompleted(pending.turn, new Date().toISOString(), { state: 'interrupted' })
    pending.turn.resolve()
  }

  async mcpServers(): Promise<ProviderMcpServer[] | null> {
    if (!this.query) return null

    return (await this.query.mcpServerStatus()).map((server) => ({
      error: server.error ?? null,
      name: server.name,
      status: server.status,
    }))
  }

  async reconnectMcpServer(name: string) {
    if (!this.query)
      throw sessionIdentityErrors.SESSION_NOT_RUNNING({ internal: { sessionId: this.sessionId } })

    await this.query.reconnectMcpServer(name)
  }

  async stopBackgroundTask(taskId: string) {
    if (!this.query)
      throw sessionIdentityErrors.SESSION_NOT_RUNNING({
        internal: { sessionId: this.sessionId },
      })

    await this.query.stopTask(taskId)
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
    if (!pending) throw requestGone('approval', input.requestId)

    const result = offeredResponse(pending.offers, input.decision, input.requestId)
    this.pendingApprovals.delete(input.requestId)
    const updates = result.behavior === 'allow' ? (result.updatedPermissions ?? []) : []
    recordChatPipelineInfo('chat.pipeline.claude_session.approval.resolved', {
      decision: input.decision,
      destinations: [...new Set(updates.map((update) => update.destination))],
      requestId: input.requestId,
      ruleCount: claudePermissionUpdateCount(updates),
      sessionId: this.sessionId,
      toolName: pending.toolName,
    })
    pending.resolve(result)
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-request-resolved'),
      payload: {
        decision: input.decision,
        requestType: claudeApprovalRequestType(pending.toolName),
        resolution: { decision: input.decision },
      },
      ...this.requestResolutionContext(input.requestId),
      type: 'request.resolved',
    })
  }

  hasProcess() {
    return this.processes.some((process) => process.isAlive()) || !this.streamEnded
  }

  /** Every Stop names the session's crons, wake-ups and loops, harness-started turns included. */
  stopHook(): HookCallback {
    return async (input) => {
      if (input.hook_event_name !== 'Stop') return {}
      const schedules = (input.session_crons ?? []).map((cron) => ({
        id: cron.id,
        prompt: cron.prompt,
        recurring: cron.recurring,
        schedule: cron.schedule,
      }))
      this.emit({
        createdAt: new Date().toISOString(),
        eventId: runtimeEventId('claude-schedules-updated'),
        payload: { schedules },
        provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
        providerInstanceId: this.providerInstanceId,
        providerBindingHandle: this.providerBindingHandle(),
        runtimeMode: this.runtimeMode,
        sessionId: this.sessionId,
        ...(this.activeTurn ? { turnId: this.activeTurn.canonicalTurnId } : {}),
        type: 'schedules.updated',
      })
      return {}
    }
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
    const record = asRecord(message)
    if (stringField(record, 'type') === 'command_lifecycle') {
      const commandUuid = stringField(record, 'command_uuid')
      const state = stringField(record, 'state')
      if (commandUuid && state) this.handleCommandLifecycle(commandUuid, state)
      return
    }
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
        this.handleRateLimitEvent(message)
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
            hookEvent: message.hook_event,
            hookId: message.hook_id,
            hookName: message.hook_name,
            outcome: claudeHookOutcome(message),
            output: message.output,
            stderr: message.stderr,
            stdout: message.stdout,
          },
          message,
        )
        return
      case 'task_started':
        this.rememberTaskType(message.task_id, message.task_type ?? message.subagent_type)
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
            taskType: this.taskTypes.get(message.task_id),
            usage: message.usage,
          },
          message,
        )
        return
      case 'task_updated':
        this.handleTaskUpdated(message)
        return
      case 'task_notification':
        // With no turn running, the harness is about to start one to read this; with the owner's
        // prompt still queued, that turn runs first and its result is not the owner's.
        if (!this.activeTurn) this.nextHarnessOrigin = 'task'
        if (this.activeOrigin === null && this.activeAwaitingStart)
          this.foreignResultsBeforeStart += 1
        this.emitRuntimeNotification(
          'task.completed',
          {
            status: message.status,
            summary: message.summary,
            taskId: message.task_id,
            taskType: this.taskTypes.get(message.task_id),
            usage: message.usage,
          },
          message,
        )
        this.taskTypes.delete(message.task_id)
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
        // Ambient tasks are watchers the SDK says to keep out of activity indicators.
        this.emitRuntimeNotification(
          'tasks.roster',
          {
            tasks: message.tasks
              .filter((task) => !task.ambient)
              .map((task) => ({
                description: task.description,
                taskId: task.task_id,
                taskType: task.task_type,
              })),
          },
          message,
        )
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
  private rememberTaskType(taskId: string, taskType: string | undefined) {
    if (taskType) this.taskTypes.set(taskId, taskType)
  }

  private handleTaskUpdated(message: ClaudeSystemMessageOf<'task_updated'>) {
    const patch = message.patch
    const terminal = claudeTerminalTaskStatus(patch.status)
    if (terminal) {
      this.emitRuntimeNotification(
        'task.completed',
        {
          status: terminal,
          summary: patch.error ?? patch.description,
          taskId: message.task_id,
          taskType: this.taskTypes.get(message.task_id),
        },
        message,
      )
      this.taskTypes.delete(message.task_id)
      return
    }

    this.emitRuntimeNotification(
      'task.progress',
      {
        description: patch.description ?? `Task ${patch.status ?? 'updated'}`,
        taskId: message.task_id,
        taskType: this.taskTypes.get(message.task_id),
        status: patch.status,
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
    this.taskTypes.delete(message.tool_use_id)
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
    // Every turn opens with `init`. With nothing running it is the owner's queued prompt (a CLI
    // without lifecycle frames) or a turn the harness started, such as a task notification.
    if (!this.activeTurn && this.pendingTurn) this.startPendingTurn()
    if (!this.activeTurn) this.adoptHarnessTurn(this.nextHarnessOrigin ?? 'provider', message.uuid)

    this.emitRuntimeNotification('runtime.configured', { config: asRecord(message) }, message)
  }

  private confirmSessionId(sessionId: string) {
    if (sessionId === this.sessionId) return

    const error = sessionIdentityErrors.SESSION_IDENTITY_MISMATCH({
      internal: { observed: sessionId, expected: this.sessionId },
    })
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
    this.rememberTaskType(toolUseId, toolName)

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
    this.taskTypes.delete(toolUseId)
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
    // Totals reset on `/clear`, which opens a new conversation id, so that id scopes them.
    this.emitRuntimeNotification(
      'usage.totals',
      {
        totals: claudeUsageTotals(
          this.providerConversationMarker ?? this.sessionId,
          // A resumed conversation carries its saved totals until `/clear` opens a new one.
          this.resumed && this.providerConversationMarker === null,
          message.modelUsage ?? {},
        ),
      },
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
    if (this.activeAwaitingStart && this.foreignResultsBeforeStart > 0) {
      this.foreignResultsBeforeStart -= 1
      recordChatPipelineInfo('chat.pipeline.claude_session.result.harness_turn_before_prompt', {
        sessionId: this.sessionId,
        turnId: turn.canonicalTurnId,
      })
      return
    }
    if (message.subtype === 'success') {
      this.completeTurn(turn, message.usage, claudeSuccessEndReason(message))
      return
    }
    // An interrupt is a user action, not a failure: it must RESOLVE the turn,
    // exactly as codex resolves a turn whose status came back 'interrupted'.
    if (isInterruptedClaudeResult(message)) {
      this.interruptTurnResult(turn, message.usage)
      return
    }

    this.rejectTurn(turn, claudeResultErrorMessage(message), claudeFailureEndReason(message))
  }

  private completeTurn(turn: ActiveProviderTurn, usage: unknown, endReason?: TurnEndReason) {
    const completedAt = new Date().toISOString()
    recordChatPipelineInfo('chat.pipeline.claude_session.complete_turn', {
      messageId: turn.messageId,
      sessionId: this.sessionId,
      turnId: turn.canonicalTurnId,
    })
    this.emitTurnCompleted(turn, completedAt, {
      state: 'completed',
      usage,
      ...(endReason ? { endReason } : {}),
    })
    this.emit({
      completedAt,
      eventId: runtimeEventId('claude-assistant-complete'),
      messageId: turn.messageId,
      sessionId: this.sessionId,
      turnId: turn.canonicalTurnId,
      type: 'assistant.complete',
    })
    // Bound to the turn that ended: a harness turn the log never took must not settle another.
    this.ingestSession('ready', turn.canonicalTurnId)
    this.resolveTurn(turn)
  }

  private interruptTurnResult(turn: ActiveProviderTurn, usage: unknown) {
    recordChatPipelineInfo('chat.pipeline.claude_session.interrupt_turn', {
      sessionId: this.sessionId,
      turnId: turn.canonicalTurnId,
    })
    this.emitTurnCompleted(turn, new Date().toISOString(), { state: 'interrupted', usage })
    this.ingestSession('ready', turn.canonicalTurnId)
    this.resolveTurn(turn)
  }

  private rejectTurn(
    turn: ActiveProviderTurn,
    message: string,
    endReason: TurnEndReason = 'provider-error',
  ) {
    this.status = 'error'
    this.emitTurnCompleted(turn, new Date().toISOString(), {
      endReason,
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
    this.activeOrigin = null
    this.activeProviderTurnId = null
    this.activeAwaitingStart = false
    this.foreignResultsBeforeStart = 0
    this.inFlightTools.clear()
  }

  private rejectAllTurns(error: Error) {
    const pending = this.pendingTurn
    this.pendingTurn = null
    pending?.turn.reject(error)
    const turn = this.activeTurn
    if (!turn) return

    this.clearActiveTurn(turn)
    turn.reject(error)
  }

  private async resolveAttachments(input: ProviderTurnInput): Promise<ResolvedAttachment[]> {
    const resolved: ResolvedAttachment[] = []
    for (const attachment of input.attachments) {
      const attachmentsDir = input.attachmentsDir ?? this.attachmentsDir
      if (attachment.type === 'file') {
        const filePath = attachmentFilePath({ attachment, attachmentsDir })
        if (!filePath || !(await Bun.file(filePath).exists()))
          throw createInternalError('Attached file is unavailable.')
        resolved.push({ attachment, path: filePath })
        continue
      }
      const bytes = await readAttachmentBytes({ attachment, attachmentsDir })
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
    if (!pending) throw requestGone('user-input', input.requestId)

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
      ...this.requestResolutionContext(input.requestId),
      type: 'user-input.resolved',
    })
  }

  private requestResolutionContext(requestId: ApprovalRequestId) {
    return {
      provider: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
      providerInstanceId: this.providerInstanceId,
      providerBindingHandle: this.providerBindingHandle(),
      requestId,
      runtimeMode: this.runtimeMode,
      sessionId: this.sessionId,
      ...(this.activeTurn ? { turnId: this.activeTurn.canonicalTurnId } : {}),
    }
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

    const offers = claudeApprovalOffers(options, toolInput)

    return new Promise<PermissionResult>((resolve) => {
      this.pendingApprovals.set(requestId, { offers, resolve, toolName })
      options.signal.addEventListener('abort', () => this.abortApproval(requestId), { once: true })
      this.emitApprovalOpened(requestId, toolName, toolInput, {
        defaultToNo: options.defaultToNo === true,
        options: offeredOptions(offers),
      })
    })
  }

  private abortApproval(requestId: ApprovalRequestId) {
    const pending = this.pendingApprovals.get(requestId)
    if (!pending) return

    this.pendingApprovals.delete(requestId)
    pending.resolve({ behavior: 'deny', message: 'Claude tool approval was aborted.' })
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-request-ended'),
      payload: { requestType: claudeApprovalRequestType(pending.toolName), resolution: 'ended' },
      ...this.requestResolutionContext(requestId),
      type: 'request.resolved',
    })
  }

  private emitApprovalOpened(
    requestId: ApprovalRequestId,
    toolName: string,
    toolInput: Record<string, unknown>,
    choices: { defaultToNo: boolean; options: readonly ProviderApprovalOption[] },
  ) {
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-request-opened'),
      payload: {
        args: toolInput,
        detail: claudeToolSummary(toolName, toolInput),
        ...choices,
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

  private emitTurnStarted(providerTurnId: string, origin?: ProviderTurnOrigin) {
    this.emit({
      createdAt: new Date().toISOString(),
      eventId: runtimeEventId('claude-turn-started'),
      payload: { model: this.model, ...(origin ? { origin } : {}) },
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
      endReason?: TurnEndReason
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
        { usage: claudeContextUsage(context) },
        message,
      )
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.claude_session.context_usage.failed', {
        error,
        sessionId: this.sessionId,
      })
    }
  }

  private handleRateLimitEvent(message: SDKRateLimitEvent) {
    const info = message.rate_limit_info
    const scopedModel = this.scopedUsageModel()
    this.emitRuntimeNotification(
      'account.rate-limits.updated',
      claudeUsageUpdate(info, scopedModel),
      message,
    )
    if (!claudeBlocksTurn(info) || !this.activeTurn) return

    // The SDK parks a rejected turn without a word; say why, once per window and reset.
    const key = `${info.rateLimitType ?? 'unknown'}:${info.resetsAt ?? ''}`
    if (this.announcedLimitStops.has(key)) return

    this.announcedLimitStops.add(key)
    const window = claudeEventWindow(info.rateLimitType, scopedModel)
    const resetsAt = typeof info.resetsAt === 'number' ? new Date(info.resetsAt * 1000) : null
    const text = usageLimitMessage({
      atMs: Date.now(),
      provider: 'Claude',
      window: window ? { label: window.label, resetsAt: resetsAt?.toISOString() ?? null } : null,
    })
    this.emitRuntimeNotification('runtime.warning', { detail: info, message: text }, message)
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
 * local initialization IPC — returning account state and its model list —
 * without ever sending a request to Anthropic or burning a turn. We read init, then abort.
 */
async function probeClaudeInitialization(
  createQuery: ClaudeCreateQuery,
  env: NodeJS.ProcessEnv,
  executablePath: string,
): Promise<{ account: AccountInfo | undefined; models: readonly ModelInfo[] }> {
  const abortController = new AbortController()
  const query = createQuery({
    options: claudeProbeOptions(abortController, env, executablePath),
    prompt: neverYieldingPrompt(abortController.signal),
  })

  try {
    const initialization = await withClaudeTimeout(
      query.initializationResult(),
      CLAUDE_INIT_TIMEOUT_MS,
      'Claude capability probe timed out.',
    )

    return { account: initialization.account, models: initialization.models ?? [] }
  } finally {
    abortController.abort()
  }
}

/**
 * `get_usage` on the same never-yielding probe: the CLI reads the plan windows from
 * claude.ai with its own credentials, so no turn is spent and no token leaves the CLI.
 * `skipBehaviors` skips the local transcript scan the `/usage` dialog also runs.
 */
async function probeClaudeUsage(
  createQuery: ClaudeCreateQuery,
  env: NodeJS.ProcessEnv,
  executablePath: string,
) {
  const abortController = new AbortController()
  const query = createQuery({
    options: claudeProbeOptions(abortController, env, executablePath),
    prompt: neverYieldingPrompt(abortController.signal),
  })

  try {
    await withClaudeTimeout(
      query.initializationResult(),
      CLAUDE_USAGE_INIT_TIMEOUT_MS,
      'Claude usage probe timed out starting.',
    )

    return await withClaudeTimeout(
      query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      CLAUDE_USAGE_TIMEOUT_MS,
      'Claude usage read timed out.',
    )
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
  executablePath: string,
  cwd: string | undefined,
): Promise<ProviderCommandCatalogResult> {
  const abortController = new AbortController()
  const query = createQuery({
    options: {
      ...claudeProbeOptions(abortController, env, executablePath),
      ...(cwd ? { cwd } : {}),
    },
    prompt: neverYieldingPrompt(abortController.signal),
  })

  try {
    const initialization = await withClaudeTimeout(
      query.initializationResult(),
      CLAUDE_INIT_TIMEOUT_MS,
      'Claude command catalog probe timed out.',
    )

    return {
      agents: claudeAgents(initialization.agents),
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

function claudeAgents(agents: readonly AgentInfo[] | undefined): ProviderAgent[] {
  return (agents ?? [])
    .filter((agent) => agent.name.trim().length > 0)
    .map((agent) => ({
      description: agent.description.trim(),
      model: agent.model?.trim() || null,
      name: agent.name.trim(),
    }))
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

function claudeProbeOptions(
  abortController: AbortController,
  env: NodeJS.ProcessEnv,
  executablePath: string,
): Options {
  return {
    abortController,
    // MCP must be neutralized or the health check becomes heavyweight and flaky.
    // The first three cover filesystem-configured servers; claude.ai connectors
    // are discovered outside filesystem config and need the env flag as well.
    allowedTools: [],
    env: { ...env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
    mcpServers: {},
    pathToClaudeCodeExecutable: executablePath,
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
 * only decoration on top of it. A failed read stays `unknown`.
 */
function claudeAuthState(cli: ClaudeAuthState, account: unknown): ClaudeProviderAuthState {
  if (cli.status === 'unknown') return { auth: { status: 'unknown' }, status: 'ready' }
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

/** The snapshot has one line for the providers UI, so a catalog error brings its fix along. */
function claudeSnapshotErrorMessage(error: unknown) {
  const message = providerErrorMessage(error)
  if (!isEvlogError(error) || !error.fix) return message

  return `${message}. ${error.fix}`
}

function isUnsupportedClaudeImage(mimeType: string, attachmentType: string) {
  if (attachmentType !== 'image') return false

  return claudeImageMediaType(mimeType) === null
}

function claudeStreamKind(deltaType: string) {
  return deltaType.includes('thinking') ? ('reasoning_text' as const) : ('assistant_text' as const)
}

/** The SDK's native tool names. A user's MCP tool is `mcp__server__tool`, whatever its display name. */
const CLAUDE_NATIVE_ITEM_TYPES: Readonly<Record<string, string>> = {
  Agent: 'unknown',
  Bash: 'command_execution',
  Edit: 'file_change',
  MultiEdit: 'file_change',
  NotebookEdit: 'file_change',
  PowerShell: 'command_execution',
  Read: 'image_view',
  Task: 'unknown',
  WebFetch: 'web_search',
  WebSearch: 'web_search',
  Write: 'file_change',
}

function claudeItemType(toolName: string) {
  if (toolName.startsWith('mcp__')) return 'mcp_tool_call'

  return CLAUDE_NATIVE_ITEM_TYPES[toolName] ?? 'dynamic_tool_call'
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
  return toolName === 'Task' || toolName === 'Agent'
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

/**
 * The result message sums every API call of the turn, so on a multi-call turn it
 * overstates occupancy: it is an estimate until `getContextUsage` reports.
 */
function claudeTokenUsage(usage: unknown) {
  const record = asRecord(usage)
  const inputTokens = numberField(record, 'input_tokens')
  const outputTokens = numberField(record, 'output_tokens')
  const cacheWriteTokens = numberField(record, 'cache_creation_input_tokens')
  const cachedInputTokens = numberField(record, 'cache_read_input_tokens')
  const reasoningOutputTokens = numberField(
    asRecord(record.output_tokens_details),
    'thinking_tokens',
  )
  const usedTokens =
    (inputTokens ?? 0) + (outputTokens ?? 0) + (cacheWriteTokens ?? 0) + (cachedInputTokens ?? 0)

  return {
    estimated: true,
    usedTokens,
    ...(inputTokens === null ? {} : { inputTokens }),
    ...(cachedInputTokens === null ? {} : { cachedInputTokens }),
    ...(cacheWriteTokens === null ? {} : { cacheWriteTokens }),
    ...(outputTokens === null ? {} : { outputTokens }),
    ...(reasoningOutputTokens === null ? {} : { reasoningOutputTokens }),
  }
}

/**
 * `maxTokens` includes the compaction reserve when the CLI keeps one (the
 * `buffer` category), so the usable window is the rest. Classified on `kind`,
 * never on the English name.
 */
function claudeContextUsage(context: SDKControlGetContextUsageResponse) {
  const reserveTokens = context.categories
    .filter((category) => category.kind === 'buffer')
    .reduce((sum, category) => sum + category.tokens, 0)
  return {
    compactsAutomatically: true,
    maxTokens: Math.max(1, context.maxTokens - reserveTokens),
    ...(reserveTokens > 0 ? { reserveTokens } : {}),
    segments: context.categories
      .filter((category) => category.kind === 'used' || category.kind === 'deferred')
      .filter((category) => category.tokens > 0)
      .map((category) => ({ kind: category.kind, name: category.name, tokens: category.tokens })),
    usedTokens: context.totalTokens,
  }
}

/** The CLI stamps aborts: mid-tool-call is `aborted_tools`, mid-stream `aborted_streaming`. */
function isInterruptedClaudeResult(message: Extract<SDKMessage, { type: 'result' }>) {
  return (
    message.terminal_reason === 'aborted_tools' || message.terminal_reason === 'aborted_streaming'
  )
}

/** A turn that finished but was cut short: the answer is complete as far as it goes. */
function claudeSuccessEndReason(
  message: Extract<SDKMessage, { type: 'result' }>,
): TurnEndReason | undefined {
  if (message.is_error) return 'provider-error'
  if (message.stop_reason === 'max_tokens') return 'output-limit'
  if (message.stop_reason === 'refusal') return 'refusal'

  return undefined
}

function claudeFailureEndReason(message: Extract<SDKMessage, { type: 'result' }>): TurnEndReason {
  if (message.subtype === 'error_max_turns') return 'turn-limit'
  if (message.terminal_reason === 'max_turns') return 'turn-limit'
  if (message.stop_reason === 'refusal') return 'refusal'

  return 'provider-error'
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

/** Exit code 2 is Claude Code's documented "block this action" signal. */
function claudeHookOutcome(message: { exit_code?: number; outcome: ProviderHookOutcome }) {
  if (message.outcome === 'error' && message.exit_code === 2) return 'blocked'

  return message.outcome
}
