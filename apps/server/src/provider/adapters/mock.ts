import { createInternalError } from '../../observability/structured-errors'

import { existsSync, readFileSync } from 'node:fs'

import {
  DEFAULT_CODEX_PROVIDER_SETTINGS,
  type ProviderModel,
  type ProviderApprovalDecision,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderInstanceSettings,
  type ProviderSnapshot,
  type ProviderUserInputAnswers,
  type ApprovalRequestId,
  type SessionId,
} from '@workspace/contracts'
import { ProviderRuntimeEventStream } from '../provider-runtime-event-stream'
import type {
  ProviderAdapter,
  ProviderCommandCatalogInput,
  ProviderCommandCatalogResult,
  ProviderRuntimeEvent,
  ProviderRuntimeStartInput,
  ProviderTurnInput,
} from '../types'
import { sessionInputFromTurn } from './utils/session-input'
import {
  mockTurnAnatomyModel,
  mockTurnAnatomySteps,
  type MockTurnScript,
} from './utils/mock-turn-anatomy'

const DEFAULT_SCRIPT_STEP_DELAY_MS = 700

export type MockProviderAdapterOptions = {
  operationTimeoutMs?: number
  /** Thrown as-is, so a test can raise a catalog error such as `REQUEST_GONE`. */
  approvalError?: Error
  auth?: ProviderSnapshot['auth']
  beforeComplete?: () => Promise<void> | void
  /** Replaces the default catalog; `{ commands: [], skills: [] }` models a provider with nothing to offer. */
  commandCatalog?: ProviderCommandCatalogResult
  displayLabel?: string
  driverKind?: ProviderDriverKind
  enabled?: boolean
  /** Resolved per-instance env, so multi-instance isolation is observable in tests. */
  env?: NodeJS.ProcessEnv
  interruptError?: string
  models?: readonly ProviderModel[]
  /** Makes `snapshot()` report a failed probe, the way a flaky CLI read does. */
  probeError?: string
  providerInstanceId?: ProviderInstanceId
  responseText?: string
  /** A scripted turn in place of the one-line answer; see `mock-turn-anatomy.ts`. */
  script?: MockTurnScript
  /** Pause between scripted steps, so a reader can watch each one land. */
  stepDelayMs?: number
  shouldFail?: boolean
  stopError?: string
  userInputError?: Error
}

export const MOCK_ADAPTER_CAPABILITIES = {
  conversationRollback: true,
  listCommands: true,
  sessionModelSwitch: 'in-session',
} satisfies ProviderAdapter['capabilities']

/**
 * Deliberately unsorted, and deliberately mixed: one command with an argument
 * hint, one with an alias, one disabled skill, one plugin-scoped skill. A
 * consumer that assumes provider order is already ranked, or that every listed
 * skill is runnable, breaks against this.
 */
const MOCK_TURN_INPUT_TOKENS = 10
const MOCK_CONTEXT_WINDOW = 200_000
const MOCK_SYSTEM_TOKENS = 4_000

const MOCK_COMMAND_CATALOG: ProviderCommandCatalogResult = {
  agents: [{ description: 'Reviews a diff before it lands', model: null, name: 'reviewer' }],
  commands: [
    { description: 'Summarize the conversation so far', name: 'summarize' },
    { argumentHint: '<path>', description: 'Review a file', name: 'review' },
    { aliases: ['stats'], description: 'Show token usage', name: 'usage' },
  ],
  skills: [
    { description: 'Read and edit PDF files', enabled: true, name: 'pdf' },
    { description: 'Build slide decks', enabled: false, name: 'pptx' },
    { description: 'Review UI code', enabled: true, name: 'web-design', scope: 'anthropic-skills' },
  ],
}

export class MockProviderAdapter implements ProviderAdapter {
  readonly operationTimeoutMs: number
  readonly adapterKey: ProviderInstanceId
  readonly capabilities: ProviderAdapter['capabilities'] = MOCK_ADAPTER_CAPABILITIES
  readonly driverKind: ProviderDriverKind
  readonly approvalResponses: Array<{
    decision: ProviderApprovalDecision
    requestId: ApprovalRequestId
    sessionId: SessionId
  }> = []
  readonly interruptedSessions: SessionId[] = []
  readonly commandCatalogReads: ProviderCommandCatalogInput[] = []
  readonly rollbacks: Array<{ numTurns: number; sessionId: SessionId }> = []
  readonly startedSessions: ProviderRuntimeStartInput[] = []
  readonly startedTurns: ProviderTurnInput[] = []
  readonly userInputResponses: Array<{
    answers: ProviderUserInputAnswers
    requestId: ApprovalRequestId
    sessionId: SessionId
  }> = []
  readonly env: NodeJS.ProcessEnv
  /** Mutable so a harness can make a healthy provider start failing mid-run. */
  probeError: string | null
  private readonly events = new ProviderRuntimeEventStream()
  private readonly sessions = new Map<SessionId, ProviderRuntimeStartInput>()
  private readonly settings: ProviderInstanceSettings
  private readonly approvalError: Error | null
  private readonly authOverride: ProviderSnapshot['auth'] | null
  private readonly beforeComplete: (() => Promise<void> | void) | null
  private readonly commandCatalog: ProviderCommandCatalogResult
  private readonly interruptError: string | null
  private readonly modelsOverride: readonly ProviderModel[] | null
  private readonly responseText: string
  private readonly script: MockTurnScript | null
  private readonly stepDelayMs: number
  private readonly completedTurns = new Map<SessionId, number>()
  private readonly shouldFail: boolean
  private readonly stopError: string | null
  private readonly userInputError: Error | null

  constructor(options: MockProviderAdapterOptions = {}) {
    this.operationTimeoutMs = options.operationTimeoutMs ?? 30_000
    this.adapterKey =
      options.providerInstanceId ?? DEFAULT_CODEX_PROVIDER_SETTINGS.providerInstanceId
    this.driverKind = options.driverKind ?? DEFAULT_CODEX_PROVIDER_SETTINGS.driverKind
    this.env = options.env ?? {}
    this.settings = {
      ...DEFAULT_CODEX_PROVIDER_SETTINGS,
      displayLabel: options.displayLabel ?? DEFAULT_CODEX_PROVIDER_SETTINGS.displayLabel,
      driverKind: this.driverKind,
      enabled: options.enabled ?? DEFAULT_CODEX_PROVIDER_SETTINGS.enabled,
      providerInstanceId: this.adapterKey,
    }
    this.approvalError = options.approvalError ?? null
    this.authOverride = options.auth ?? null
    this.beforeComplete = options.beforeComplete ?? null
    this.commandCatalog = options.commandCatalog ?? MOCK_COMMAND_CATALOG
    this.interruptError = options.interruptError ?? null
    this.modelsOverride = options.models ?? null
    this.probeError = options.probeError ?? null
    this.responseText = options.responseText ?? 'Mock response'
    this.script = options.script ?? null
    this.stepDelayMs = options.stepDelayMs ?? DEFAULT_SCRIPT_STEP_DELAY_MS
    this.shouldFail = options.shouldFail ?? false
    this.stopError = options.stopError ?? null
    this.userInputError = options.userInputError ?? null
  }

  async snapshot(): Promise<ProviderSnapshot> {
    if (this.probeError) {
      return {
        ...this.settings,
        auth: { status: 'unknown' },
        checkedAt: new Date().toISOString(),
        installed: true,
        message: this.probeError,
        models: [],
        status: 'error',
        version: null,
      }
    }

    return {
      ...this.settings,
      auth: this.authOverride ?? mockAuth(this.env),
      checkedAt: new Date().toISOString(),
      installed: true,
      models: this.snapshotModels(),
      status: 'ready',
      version: 'mock',
    }
  }

  async listCommands(input: ProviderCommandCatalogInput): Promise<ProviderCommandCatalogResult> {
    this.commandCatalogReads.push(input)

    return this.commandCatalog
  }

  subscribeEvents(subscriber: (event: ProviderRuntimeEvent) => void) {
    return this.events.subscribe(subscriber)
  }

  async startRuntime(input: ProviderRuntimeStartInput) {
    // Mirrors the real adapters: a session that was not resumed mints the
    // cursor its own conversation can later be resumed from.
    const providerResumeCursor =
      input.providerResumeCursor ?? `mock-conversation:${input.sessionId}`
    this.startedSessions.push(input)
    this.sessions.set(input.sessionId, { ...input, providerResumeCursor })
    this.events.publish({
      createdAt: new Date().toISOString(),
      eventId: `mock-session-started:${input.sessionId}`,
      payload: { resume: providerResumeCursor },
      provider: this.driverKind,
      providerInstanceId: input.providerInstanceId,
      providerBindingHandle: `mock:${input.sessionId}`,
      raw: {
        payload: input,
        source: 'codex.sdk.thread-event',
      },
      runtimeMode: input.runtimeMode,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
      type: 'runtime.started',
    })
    this.events.publish({
      createdAt: new Date().toISOString(),
      eventId: `mock-conversation-started:${input.sessionId}`,
      payload: { providerConversationMarker: `mock-conversation:${input.sessionId}` },
      provider: this.driverKind,
      providerInstanceId: input.providerInstanceId,
      providerBindingHandle: `mock:${input.sessionId}`,
      runtimeMode: input.runtimeMode,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
      type: 'conversation.started',
    })

    return {
      cwd: input.cwd,
      model: input.modelSelection.model,
      providerInstanceId: input.providerInstanceId as ProviderInstanceId,
      providerBindingHandle: `mock:${input.sessionId}`,
      providerConversationMarker: `mock-conversation:${input.sessionId}`,
      providerResumeCursor,
      runtimeMode: input.runtimeMode,
      status: 'ready' as const,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
    }
  }

  async sendTurn(input: ProviderTurnInput) {
    this.startedTurns.push(input)
    if (!this.sessions.has(input.sessionId)) await this.startRuntime(sessionInputFromTurn(input))
    if (this.shouldFail) throw createInternalError('Mock provider failed')
    await Promise.resolve(this.beforeComplete?.())

    const messageId = `assistant:${input.turnId}`
    this.publishTurnStarted(input)
    if (this.script) {
      void this.runScriptedTurn(input, messageId)
      return
    }
    this.events.publish({
      createdAt: new Date().toISOString(),
      delta: this.responseText,
      eventId: `mock-delta:${input.turnId}`,
      messageId,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
      turnId: input.turnId,
      type: 'assistant.delta',
    })
    this.publishAnswerEnd(input, messageId)
  }

  private snapshotModels() {
    if (this.modelsOverride) return this.modelsOverride.slice()

    return [this.script ? mockTurnAnatomyModel() : mockModel()]
  }

  private publishTurnStarted(input: ProviderTurnInput) {
    this.events.publish({
      createdAt: new Date().toISOString(),
      eventId: `mock-turn-started:${input.turnId}`,
      payload: { model: input.modelSelection.model },
      provider: this.driverKind,
      providerInstanceId: input.providerInstanceId,
      providerBindingHandle: `mock:${input.sessionId}`,
      runtimeMode: input.runtimeMode,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
      turnId: input.turnId,
      type: 'turn.started',
    })
  }

  /** Publishes each step after its delay; a stop ends the script where it stands. */
  private async runScriptedTurn(input: ProviderTurnInput, messageId: string) {
    const interruptsBefore = this.interruptedSessions.length
    const stopped = () => this.interruptedSessions.slice(interruptsBefore).includes(input.sessionId)
    for (const step of mockTurnAnatomySteps(input, this.stepDelayMs)) {
      await Bun.sleep(step.delayMs)
      if (stopped()) return this.publishTurnEnd(input, 'interrupted')

      this.events.publish({
        ...step.event,
        createdAt: new Date().toISOString(),
      } as ProviderRuntimeEvent)
    }
    this.publishAnswerEnd(input, messageId)
  }

  /** The answer's completion, usage totals and the turn's end, in the order providers send them. */
  private publishAnswerEnd(input: ProviderTurnInput, messageId: string) {
    this.events.publish({
      completedAt: new Date().toISOString(),
      eventId: `mock-complete:${input.turnId}`,
      messageId,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
      turnId: input.turnId,
      type: 'assistant.complete',
    })
    this.publishUsageTotals(input)
    this.publishTurnEnd(input, 'completed')
  }

  private publishTurnEnd(input: ProviderTurnInput, state: 'completed' | 'interrupted') {
    this.events.publish({
      createdAt: new Date().toISOString(),
      eventId: `mock-turn-completed:${input.turnId}`,
      payload: { state },
      provider: this.driverKind,
      providerInstanceId: input.providerInstanceId,
      providerBindingHandle: `mock:${input.sessionId}`,
      runtimeMode: input.runtimeMode,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
      turnId: input.turnId,
      type: 'turn.completed',
    })
  }

  /** Deterministic running totals, as a real provider reports them: they only grow. */
  private publishUsageTotals(input: ProviderTurnInput) {
    const turns = (this.completedTurns.get(input.sessionId) ?? 0) + 1
    this.completedTurns.set(input.sessionId, turns)
    this.events.publish({
      createdAt: new Date().toISOString(),
      eventId: `mock-usage-totals:${input.turnId}`,
      payload: {
        totals: [
          {
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            continuesEarlierTurns: false,
            costUsd: null,
            inputTokens: turns * MOCK_TURN_INPUT_TOKENS,
            model: input.modelSelection.model,
            outputTokens: turns * this.responseText.length,
            reasoningTokens: 0,
            scope: input.sessionId,
          },
        ],
      },
      provider: this.driverKind,
      providerInstanceId: input.providerInstanceId,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
      turnId: input.turnId,
      type: 'usage.totals',
    })
    const messageTokens = turns * (MOCK_TURN_INPUT_TOKENS + this.responseText.length)
    this.events.publish({
      createdAt: new Date().toISOString(),
      eventId: `mock-context-usage:${input.turnId}`,
      payload: {
        usage: {
          maxTokens: MOCK_CONTEXT_WINDOW,
          segments: [
            { kind: 'used', name: 'System prompt', tokens: MOCK_SYSTEM_TOKENS },
            { kind: 'used', name: 'Messages', tokens: messageTokens },
          ],
          usedTokens: MOCK_SYSTEM_TOKENS + messageTokens,
        },
      },
      provider: this.driverKind,
      providerInstanceId: input.providerInstanceId,
      runtimeEpoch: input.runtimeEpoch,
      sessionId: input.sessionId,
      turnId: input.turnId,
      type: 'conversation.token-usage.updated',
    })
  }

  async hasRuntime({ sessionId }: { sessionId: SessionId }) {
    return this.sessions.has(sessionId)
  }

  async prepareRollbackSession({
    numTurns,
    sessionId,
  }: {
    numTurns: number
    sessionId: SessionId
  }) {
    if (!Number.isInteger(numTurns) || numTurns < 1) {
      throw createInternalError('Mock provider rollback requires numTurns >= 1.')
    }

    return async () => {
      this.rollbacks.push({ numTurns, sessionId })
    }
  }

  async interruptTurn({ sessionId }: { sessionId: SessionId }) {
    if (this.interruptError) throw createInternalError(this.interruptError)

    this.interruptedSessions.push(sessionId)
  }

  async stopRuntime({ sessionId }: { sessionId: SessionId }) {
    if (this.stopError) throw createInternalError(this.stopError)

    this.sessions.delete(sessionId)
    this.interruptedSessions.push(sessionId)
  }

  async stopAll() {
    this.sessions.clear()
  }

  async respondApproval(input: {
    decision: ProviderApprovalDecision
    requestId: ApprovalRequestId
    sessionId: SessionId
  }) {
    if (this.approvalError) throw this.approvalError

    this.approvalResponses.push(input)
  }

  async respondUserInput(input: {
    answers: ProviderUserInputAnswers
    requestId: ApprovalRequestId
    sessionId: SessionId
  }) {
    if (this.userInputError) throw this.userInputError

    this.userInputResponses.push(input)
  }
}

function mockModel(): ProviderModel {
  return {
    capabilities: null,
    isCustom: false,
    name: 'GPT-5.5',
    shortName: 'GPT-5.5',
    slug: 'gpt-5.5',
  }
}

/**
 * Reads the credentials file named by the instance env, so a mock instance
 * reports the same authenticated/unauthenticated transition a real CLI does
 * when someone signs in out of band.
 */
function mockAuth(env: NodeJS.ProcessEnv): ProviderSnapshot['auth'] {
  const credentialsPath = env.PLATFORM_MOCK_CREDENTIALS
  if (!credentialsPath) return { status: 'unknown' }
  if (!existsSync(credentialsPath)) return { status: 'unauthenticated' }

  return { status: 'authenticated', label: readFileSync(credentialsPath, 'utf8').trim() }
}
