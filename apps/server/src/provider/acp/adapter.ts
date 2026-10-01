import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import * as v from 'valibot'
import {
  approvalRequestIdSchema,
  jsonEqual,
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderInstanceSettings,
  type ProviderModel,
  type ProviderSnapshot,
  type ProviderUserInputAnswers,
  type SessionId,
  type UserInputQuestions,
} from '@workspace/contracts'
import { ProviderRuntimeEventStream } from '../provider-runtime-event-stream'
import { sessionIdentityErrors } from '../structured-errors'
import type {
  ProviderAdapter,
  ProviderAdapterRuntime,
  ProviderApprovalResponseInput,
  ProviderRuntimeEvent,
  ProviderRuntimeStartInput,
  ProviderTurnInput,
  ProviderTurnSteerInput,
  ProviderUserInputResponseInput,
} from '../types'
import { AcpSession, type AcpContent } from './session'
import { acpErrors } from './structured-errors'

const permissionSchema = v.object({
  sessionId: v.string(),
  toolCall: v.looseObject({ toolCallId: v.string(), title: v.optional(v.string()) }),
  options: v.array(
    v.object({
      optionId: v.string(),
      name: v.string(),
      kind: v.picklist(['allow_once', 'allow_always', 'reject_once', 'reject_always']),
    }),
  ),
})
const cursorSchema = v.object({
  schemaVersion: v.literal(1),
  sessionId: v.string(),
  providerInstanceId: v.string(),
})
const updateSchema = v.object({
  sessionId: v.string(),
  update: v.looseObject({ sessionUpdate: v.string() }),
})
const textSchema = v.object({ content: v.object({ type: v.literal('text'), text: v.string() }) })
const toolSchema = v.object({
  toolCallId: v.string(),
  title: v.optional(v.string()),
  kind: v.optional(v.string()),
  status: v.optional(v.picklist(['pending', 'in_progress', 'completed', 'failed'])),
})
const planSchema = v.object({
  entries: v.array(
    v.object({
      content: v.string(),
      status: v.picklist(['pending', 'in_progress', 'completed']),
    }),
  ),
})

type AcpTurn = {
  input: ProviderTurnInput
  pending: number
  interrupted: boolean
  failure: boolean
  stopReason: string
  done: ReturnType<typeof Promise.withResolvers<void>>
}

type SessionState = {
  input: ProviderRuntimeStartInput
  abort: AbortController
  native: Promise<AcpSession>
  nativeId: string | null
  turn: AcpTurn | null
  permissions: Map<
    ApprovalRequestId,
    {
      offered: Map<ProviderApprovalDecision, string>
      resolve: (decision: ProviderApprovalDecision) => void
    }
  >
  questions: Map<ApprovalRequestId, (answers: ProviderUserInputAnswers) => void>
}

export type AcpExtensionClient = {
  ask: (questions: UserInputQuestions) => Promise<ProviderUserInputAnswers>
  approve: (detail: string) => Promise<ProviderApprovalDecision>
  publish: (event: ProviderRuntimeEvent) => void
  eventBase: () => ReturnType<AcpProviderAdapter['eventBase']>
}

export type AcpAdapterOptions = {
  settings: ProviderInstanceSettings
  binaryPath: string
  env: NodeJS.ProcessEnv
  operationTimeoutMs: () => number
  args: (input: ProviderRuntimeStartInput) => readonly string[]
  resumeMethod: 'load' | 'resume'
  defaultModel: string
  catalog?: () => Promise<ProviderModel[]>
  clientCapabilities?: Record<string, unknown>
  authenticate: (methods: readonly { id: string }[]) => string | undefined
  steering: 'parallel' | 'cancel-replace' | 'unsupported'
  configure?: (
    session: AcpSession,
    input: ProviderRuntimeStartInput,
    signal: AbortSignal,
  ) => Promise<void>
  prompt?: (input: ProviderTurnInput) => Promise<readonly AcpContent[]>
  request?: (method: string, params: unknown, client: AcpExtensionClient) => Promise<unknown>
  notification?: (method: string, params: unknown, client: AcpExtensionClient) => void
}

export class AcpProviderAdapter implements ProviderAdapter {
  readonly capabilities = {
    conversationRollback: false,
    sessionModelSwitch: 'in-session' as const,
    signIn: false,
    listCommands: false,
  }
  readonly adapterKey
  readonly driverKind
  private readonly options: AcpAdapterOptions
  private readonly sessions = new Map<SessionId, SessionState>()
  private readonly events = new ProviderRuntimeEventStream()

  constructor(options: AcpAdapterOptions) {
    this.options = options
    this.adapterKey = options.settings.providerInstanceId
    this.driverKind = options.settings.driverKind
  }

  get operationTimeoutMs() {
    return this.options.operationTimeoutMs()
  }

  async snapshot(): Promise<ProviderSnapshot> {
    let installed = false
    try {
      await access(this.options.binaryPath, constants.X_OK)
      installed = true
    } catch {
      /* Availability reads never execute the CLI. */
    }
    const models =
      installed && this.options.settings.enabled && this.options.catalog
        ? await this.options.catalog()
        : [
            {
              slug: this.options.defaultModel,
              name: this.options.defaultModel,
              isCustom: false,
              capabilities: null,
            },
          ]
    return {
      ...this.options.settings,
      installed,
      version: null,
      status: this.options.settings.enabled ? 'warning' : 'disabled',
      availability: installed ? 'available' : 'unavailable',
      auth: { status: 'unknown' },
      checkedAt: new Date().toISOString(),
      models,
      supportsSignIn: false,
      message: installed
        ? 'Live account smoke test pending.'
        : 'Set the provider executable path to enable this agent.',
    }
  }

  async executablePath() {
    return this.options.binaryPath
  }
  async hasRuntime(input: { sessionId: SessionId }) {
    return this.sessions.has(input.sessionId)
  }
  subscribeEvents(subscriber: (event: ProviderRuntimeEvent) => void) {
    return this.events.subscribe(subscriber)
  }

  async startRuntime(input: ProviderRuntimeStartInput): Promise<ProviderAdapterRuntime> {
    if (input.providerInstanceId !== this.adapterKey)
      throw sessionIdentityErrors.SESSION_PROVIDER_CONFLICT({
        internal: { driverKind: this.driverKind },
      })
    if (input.fork || input.outputSchema)
      throw sessionIdentityErrors.SESSION_CONTROL_UNSUPPORTED({
        internal: { operation: input.fork ? 'fork' : 'output-schema' },
      })
    const existing = this.sessions.get(input.sessionId)
    let resumeCursor = input.providerResumeCursor
    if (existing && existing.input.runtimeEpoch === input.runtimeEpoch) {
      if (jsonEqual(this.options.args(existing.input), this.options.args(input)))
        return this.runtime(existing, await existing.native)
      if (existing.turn) throw acpErrors.BUSY({ internal: { operation: 'change-launch-options' } })
      resumeCursor = this.runtime(existing, await existing.native).providerResumeCursor
    }
    if (existing) await this.stopRuntime({ sessionId: input.sessionId })
    const resume = resumeCursor == null ? null : v.safeParse(cursorSchema, resumeCursor)
    if (resume && (!resume.success || resume.output.providerInstanceId !== this.adapterKey))
      throw sessionIdentityErrors.SESSION_PROVIDER_CONFLICT({ internal: { operation: 'resume' } })
    const opening = Promise.withResolvers<AcpSession>()
    const state: SessionState = {
      input,
      abort: new AbortController(),
      native: opening.promise,
      nativeId: null,
      turn: null,
      permissions: new Map(),
      questions: new Map(),
    }
    this.sessions.set(input.sessionId, state)
    const signal = AbortSignal.any([state.abort.signal, this.controlSignal()])
    let opened: AcpSession | undefined
    void opening.promise.catch(() => undefined)
    try {
      const native = await AcpSession.open({
        executable: this.options.binaryPath,
        args: this.options.args(input),
        cwd: input.cwd,
        env: this.options.env,
        signal,
        authenticate: this.options.authenticate,
        clientCapabilities: this.options.clientCapabilities,
        ...(resume?.success
          ? { resume: { sessionId: resume.output.sessionId, method: this.options.resumeMethod } }
          : {}),
        mcpServers: input.platformMcp
          ? [
              {
                type: 'http',
                name: 'fregat',
                url: input.platformMcp.url,
                headers: [{ name: 'Authorization', value: `Bearer ${input.platformMcp.token}` }],
              },
            ]
          : [],
        onClosed: () => this.closed(state),
        onNotification: (method, params) => this.notification(state, method, params),
        onRequest: (method, params) => this.request(state, method, params),
      })
      opened = native
      state.nativeId = native.sessionId
      await this.options.configure?.(native, input, signal)
      if (signal.aborted) throw acpErrors.ABORTED({ internal: { operation: 'start-runtime' } })
      opening.resolve(native)
      this.events.publish({
        ...this.eventBase(state),
        type: 'runtime.started',
        payload: { resume: this.resumeCursor(native) },
      })
      this.events.publish({
        ...this.eventBase(state),
        type: 'conversation.started',
        payload: { providerConversationMarker: native.sessionId },
      })
      return this.runtime(state, native)
    } catch (error) {
      opening.reject(error)
      if (this.sessions.get(input.sessionId) === state) this.sessions.delete(input.sessionId)
      state.abort.abort()
      await opened?.dispose()
      throw error
    }
  }

  async sendTurn(input: ProviderTurnInput) {
    await this.startRuntime(input)
    const state = this.requireSession(input.sessionId)
    if (state.turn) throw acpErrors.BUSY({ internal: { operation: 'send-turn' } })
    const native = await state.native
    await this.options.configure?.(native, input, this.controlSignal())
    const content = await this.prompt(input)
    if (state.abort.signal.aborted)
      throw acpErrors.ABORTED({ internal: { operation: 'send-turn' } })
    if (state.turn) throw acpErrors.BUSY({ internal: { operation: 'send-turn' } })
    const turn: AcpTurn = {
      input,
      pending: 1,
      interrupted: false,
      failure: false,
      stopReason: '',
      done: Promise.withResolvers<void>(),
    }
    state.turn = turn
    this.events.publish({
      ...this.eventBase(state),
      type: 'turn.started',
      payload: { model: input.modelSelection.model },
    })
    this.runPrompt(state, turn, native.prompt(content, state.abort.signal))
  }

  async steerTurn(input: ProviderTurnSteerInput) {
    const state = this.requireSession(input.sessionId)
    const turn = state.turn
    if (!turn || turn.input.turnId !== input.turnId || this.options.steering === 'unsupported')
      throw sessionIdentityErrors.STEERING_UNAVAILABLE({
        internal: { driverKind: this.driverKind, operation: 'steer' },
      })
    const native = await state.native
    const content = await this.prompt({ ...turn.input, ...input })
    if (
      state.turn !== turn ||
      state.abort.signal.aborted ||
      this.sessions.get(input.sessionId) !== state
    )
      throw sessionIdentityErrors.STEERING_UNAVAILABLE({
        internal: { driverKind: this.driverKind, operation: 'steer-preparation' },
      })
    turn.pending++
    if (this.options.steering === 'parallel') {
      this.runPrompt(
        state,
        turn,
        native.peer
          .request(
            'session/prompt',
            { sessionId: native.sessionId, prompt: content },
            state.abort.signal,
          )
          .then((result) => {
            const parsed = v.safeParse(v.object({ stopReason: v.string() }), result)
            if (!parsed.success)
              throw acpErrors.PROTOCOL({ internal: { reason: 'steer-response' } })
            return parsed.output.stopReason
          }),
      )
      return
    }
    try {
      await this.cancel(state)
      this.runPrompt(state, turn, native.prompt(content, state.abort.signal))
    } catch (error) {
      turn.failure = true
      this.finishPrompt(state, turn)
      throw error
    }
  }

  async interruptTurn(input: { sessionId: SessionId }) {
    const state = this.requireSession(input.sessionId)
    if (!state.turn) return
    state.turn.interrupted = true
    await this.cancel(state)
    await state.turn?.done.promise
  }

  async respondApproval(input: ProviderApprovalResponseInput) {
    const state = this.requireSession(input.sessionId)
    const pending = state.permissions.get(input.requestId)
    if (!pending)
      throw sessionIdentityErrors.SESSION_CONTROL_UNSUPPORTED({
        internal: { operation: 'approval-gone' },
      })
    if (input.decision !== 'cancel' && !pending.offered.has(input.decision))
      throw sessionIdentityErrors.APPROVAL_DECISION_NOT_OFFERED({
        internal: { operation: 'approval-response' },
      })
    pending.resolve(input.decision)
  }

  async respondUserInput(input: ProviderUserInputResponseInput) {
    const state = this.requireSession(input.sessionId)
    const resolve = state.questions.get(input.requestId)
    if (!resolve)
      throw sessionIdentityErrors.SESSION_CONTROL_UNSUPPORTED({
        internal: { operation: 'question-gone' },
      })
    resolve(input.answers)
  }

  async prepareRollbackSession(input: {
    sessionId: SessionId
    numTurns: number
  }): Promise<() => Promise<void>> {
    throw sessionIdentityErrors.ROLLBACK_UNSUPPORTED({
      internal: { driverKind: this.driverKind, numTurns: input.numTurns },
    })
  }

  async stopRuntime(input: { sessionId: SessionId }) {
    const state = this.sessions.get(input.sessionId)
    if (!state) return
    this.sessions.delete(input.sessionId)
    if (state.turn) state.turn.interrupted = true
    for (const permission of state.permissions.values()) permission.resolve('cancel')
    for (const resolve of state.questions.values()) resolve({})
    state.abort.abort()
    await state.native.then(
      (native) => native.dispose(),
      () => undefined,
    )
    await state.turn?.done.promise
    this.events.publish({
      ...this.eventBase(state),
      type: 'runtime.exited',
      payload: { exitKind: 'graceful', reason: 'stopped' },
    })
  }

  async stopAll() {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.stopRuntime({ sessionId })))
  }

  eventBase(state: SessionState) {
    return {
      createdAt: new Date().toISOString(),
      eventId: randomUUID(),
      runtimeEpoch: state.input.runtimeEpoch,
      sessionId: state.input.sessionId,
      turnId: state.turn?.input.turnId,
      provider: this.driverKind,
      providerInstanceId: this.adapterKey,
      runtimeMode: state.input.runtimeMode,
    }
  }

  private closed(state: SessionState) {
    if (this.sessions.get(state.input.sessionId) !== state) return
    this.sessions.delete(state.input.sessionId)
    state.abort.abort()
    for (const pending of state.permissions.values()) pending.resolve('cancel')
    for (const resolve of state.questions.values()) resolve({})
    void state.native.then(
      (native) => native.dispose(),
      () => undefined,
    )
    this.events.publish({
      ...this.eventBase(state),
      type: 'runtime.exited',
      payload: { exitKind: 'error', reason: 'Agent connection closed', recoverable: true },
    })
  }

  private requireSession(sessionId: SessionId) {
    const state = this.sessions.get(sessionId)
    if (!state)
      throw sessionIdentityErrors.SESSION_NOT_RUNNING({ internal: { driverKind: this.driverKind } })
    return state
  }

  private controlSignal() {
    return AbortSignal.timeout(this.operationTimeoutMs)
  }
  private prompt(input: ProviderTurnInput) {
    if (this.options.prompt) return this.options.prompt(input)
    if (input.attachments.length)
      throw sessionIdentityErrors.SESSION_CONTROL_UNSUPPORTED({
        internal: { operation: 'attachments' },
      })
    return Promise.resolve([{ type: 'text' as const, text: input.messageText }])
  }
  private resumeCursor(native: AcpSession) {
    return { schemaVersion: 1, sessionId: native.sessionId, providerInstanceId: this.adapterKey }
  }
  private runtime(state: SessionState, native: AcpSession): ProviderAdapterRuntime {
    return {
      ...state.input,
      model: state.input.modelSelection.model,
      providerBindingHandle: `${this.driverKind}:instance:${this.adapterKey}:${native.sessionId}`,
      providerConversationMarker: native.sessionId,
      providerResumeCursor: this.resumeCursor(native),
      status: 'ready',
    }
  }

  private runPrompt(state: SessionState, turn: AcpTurn, result: Promise<string>) {
    void result
      .then(
        (reason) => {
          turn.stopReason = reason
        },
        () => {
          if (!turn.interrupted) turn.failure = true
        },
      )
      .then(() => this.finishPrompt(state, turn))
  }
  private finishPrompt(state: SessionState, turn: AcpTurn) {
    turn.pending--
    if (turn.pending > 0) return
    for (const pending of state.permissions.values()) pending.resolve('cancel')
    for (const resolve of state.questions.values()) resolve({})
    let status: 'failed' | 'interrupted' | 'completed' = 'completed'
    if (turn.interrupted || turn.stopReason === 'cancelled') status = 'interrupted'
    if (turn.failure) status = 'failed'
    this.events.publish({
      ...this.eventBase(state),
      completedAt: new Date().toISOString(),
      messageId: `acp:${turn.input.turnId}`,
      sessionId: state.input.sessionId,
      turnId: turn.input.turnId,
      type: 'assistant.complete',
    })
    this.events.publish({
      ...this.eventBase(state),
      type: 'turn.completed',
      payload: {
        state: status,
        ...(turn.failure ? { errorMessage: 'The agent could not complete this turn.' } : {}),
      },
    })
    if (state.turn === turn) state.turn = null
    turn.done.resolve()
  }

  private async cancel(state: SessionState) {
    const native = await state.native
    const signal = this.controlSignal()
    const abort = () => {
      void native.dispose()
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      const notified = await native.cancel()
      if (!notified) native.peer.notify('session/cancel', { sessionId: native.sessionId })
      if (this.options.steering === 'parallel') await state.turn?.done.promise
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  private notification(state: SessionState, method: string, params: unknown) {
    const turn = state.turn
    if (!turn) return
    if (method !== 'session/update') {
      this.options.notification?.(method, params, this.extensionClient(state))
      return
    }
    const frame = v.safeParse(updateSchema, params)
    if (!frame.success || frame.output.sessionId !== state.nativeId) return
    const update = frame.output.update
    if (
      update.sessionUpdate === 'agent_message_chunk' ||
      update.sessionUpdate === 'agent_thought_chunk'
    ) {
      const text = v.safeParse(textSchema, update)
      if (!text.success) return
      if (update.sessionUpdate === 'agent_message_chunk') {
        this.events.publish({
          ...this.eventBase(state),
          delta: text.output.content.text,
          messageId: `acp:${turn.input.turnId}`,
          turnId: turn.input.turnId,
          type: 'assistant.delta',
        })
        return
      }
      this.events.publish({
        ...this.eventBase(state),
        type: 'content.delta',
        payload: { delta: text.output.content.text, streamKind: 'reasoning_text' },
      })
      return
    }
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const tool = v.safeParse(toolSchema, update)
      if (!tool.success) return
      const finished = tool.output.status === 'completed' || tool.output.status === 'failed'
      this.events.publish({
        ...this.eventBase(state),
        itemId: tool.output.toolCallId,
        type: finished ? 'item.completed' : 'item.started',
        payload: {
          itemType: tool.output.kind ?? 'tool',
          title: tool.output.title,
          status: finished ? (tool.output.status as 'completed' | 'failed') : 'inProgress',
        },
      })
      return
    }
    if (update.sessionUpdate !== 'plan') return
    const plan = v.safeParse(planSchema, update)
    if (!plan.success) return
    this.events.publish({
      ...this.eventBase(state),
      type: 'turn.plan.updated',
      payload: {
        plan: plan.output.entries.map((entry) => ({
          step: entry.content,
          status: entry.status === 'in_progress' ? 'inProgress' : entry.status,
        })),
      },
    })
  }

  private async request(state: SessionState, method: string, params: unknown): Promise<unknown> {
    if (method !== 'session/request_permission') {
      if (this.options.request)
        return this.options.request(method, params, this.extensionClient(state))
      throw sessionIdentityErrors.SESSION_CONTROL_UNSUPPORTED({ internal: { operation: method } })
    }
    const parsed = v.safeParse(permissionSchema, params)
    if (!parsed.success) throw acpErrors.PROTOCOL({ internal: { reason: 'permission-shape' } })
    if (!state.turn || parsed.output.sessionId !== state.nativeId)
      return { outcome: { outcome: 'cancelled' } }
    const offered = new Map<ProviderApprovalDecision, string>()
    for (const option of parsed.output.options) {
      const decision = permissionDecision(option.kind)
      if (!offered.has(decision)) offered.set(decision, option.optionId)
    }
    if (state.input.runtimeMode === 'full-access') {
      const optionId = offered.get('acceptAlways') ?? offered.get('accept')
      return { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } }
    }
    const decision = await this.approval(
      state,
      parsed.output.toolCall.title ?? 'Agent tool permission',
      offered,
      parsed.output.options.map((option) => ({
        decision: permissionDecision(option.kind),
        label: option.name,
      })),
    )
    const optionId = offered.get(decision)
    return { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } }
  }

  private async approval(
    state: SessionState,
    detail: string,
    offered: Map<ProviderApprovalDecision, string>,
    options: readonly { decision: ProviderApprovalDecision; label: string }[],
  ) {
    const requestId = v.parse(approvalRequestIdSchema, randomUUID())
    const result = Promise.withResolvers<ProviderApprovalDecision>()
    state.permissions.set(requestId, { offered, resolve: result.resolve })
    this.events.publish({
      ...this.eventBase(state),
      requestId,
      type: 'request.opened',
      payload: { requestType: 'tool', detail, options },
    })
    const decision = await result.promise
    state.permissions.delete(requestId)
    this.events.publish({
      ...this.eventBase(state),
      requestId,
      type: 'request.resolved',
      payload: { requestType: 'tool', decision },
    })
    return decision
  }

  private extensionClient(state: SessionState): AcpExtensionClient {
    return {
      eventBase: () => this.eventBase(state),
      publish: (event) => this.events.publish(event),
      approve: (detail) =>
        this.approval(
          state,
          detail,
          new Map([
            ['accept', 'yes'],
            ['decline', 'no'],
          ]),
          [
            { decision: 'accept', label: 'Approve plan' },
            { decision: 'decline', label: 'Keep planning' },
          ],
        ),
      ask: async (questions) => {
        const requestId = v.parse(approvalRequestIdSchema, randomUUID())
        const result = Promise.withResolvers<ProviderUserInputAnswers>()
        state.questions.set(requestId, result.resolve)
        this.events.publish({
          ...this.eventBase(state),
          requestId,
          type: 'user-input.requested',
          payload: { questions },
        })
        const answers = await result.promise
        state.questions.delete(requestId)
        this.events.publish({
          ...this.eventBase(state),
          requestId,
          type: 'user-input.resolved',
          payload: { answers },
        })
        return answers
      },
    }
  }
}

function permissionDecision(kind: string): ProviderApprovalDecision {
  if (kind === 'allow_once') return 'accept'
  if (kind === 'allow_always') return 'acceptAlways'
  return 'decline'
}
