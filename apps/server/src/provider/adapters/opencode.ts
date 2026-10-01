import * as v from 'valibot'
import {
  providerDriverKindSchema,
  type ProviderInstanceId,
  type ProviderSnapshot,
  type SessionId,
} from '@workspace/contracts'
import { ProviderRuntimeEventStream } from '../provider-runtime-event-stream'
import type {
  ProviderAdapter,
  ProviderAdapterRuntime,
  ProviderApprovalResponseInput,
  ProviderRuntimeEvent,
  ProviderRuntimeStartInput,
  ProviderTurnControlInput,
  ProviderTurnInput,
} from '../types'
import { asRecord, stringField } from './utils/records'
import { sessionInputFromTurn } from './utils/session-input'
import { openCodeErrors } from './utils/opencode-errors'
import { OpenCodeHttp, readOpenCodeEvents } from './utils/opencode-http'
import { OpenCodeServer } from './utils/opencode-server'

export const OPENCODE_DRIVER_KIND = v.parse(providerDriverKindSchema, 'opencode')
export const OPENCODE_ADAPTER_CAPABILITIES = {
  conversationRollback: false,
  sessionModelSwitch: 'in-session',
  signIn: false,
  listCommands: false,
} satisfies ProviderAdapter['capabilities']

type NativeSession = {
  input: ProviderRuntimeStartInput
  id: string
  http: OpenCodeHttp
  server: OpenCodeServer
  controller: AbortController
  stream: Promise<void>
  turn: ProviderTurnInput | null
  interrupting: ProviderTurnInput | null
  assistantMessages: Set<string>
  parts: Map<string, string>
  partKinds: Map<string, 'assistant_text' | 'reasoning_text'>
  permissions: Set<string>
  sawActivity: boolean
}

type Options = {
  binaryPath?: string
  env: NodeJS.ProcessEnv
  serverUrl?: string
  displayLabel: string
  enabled: boolean
  providerInstanceId: ProviderInstanceId
}

export class OpenCodeProviderAdapter implements ProviderAdapter {
  readonly operationTimeoutMs = 30_000
  readonly driverKind = OPENCODE_DRIVER_KIND
  readonly capabilities = OPENCODE_ADAPTER_CAPABILITIES
  readonly adapterKey: ProviderInstanceId
  private readonly events = new ProviderRuntimeEventStream()
  private readonly sessions = new Map<SessionId, NativeSession>()
  private readonly starting = new Map<SessionId, Promise<ProviderAdapterRuntime>>()
  private stopped = false

  private readonly options: Options

  constructor(options: Options) {
    this.options = options
    this.adapterKey = options.providerInstanceId
  }

  subscribeEvents(subscriber: (event: ProviderRuntimeEvent) => void) {
    return this.events.subscribe(subscriber)
  }
  async hasRuntime(input: { sessionId: SessionId }) {
    return this.sessions.has(input.sessionId)
  }

  async snapshot(): Promise<ProviderSnapshot> {
    const base = {
      providerInstanceId: this.adapterKey,
      driverKind: this.driverKind,
      displayLabel: this.options.displayLabel,
      enabled: this.options.enabled,
      checkedAt: new Date().toISOString(),
      models: [],
      version: null,
      runtimeModes: ['full-access', 'approval-required', 'auto-accept-edits'],
      supportsSignIn: false,
      showInteractionModeToggle: false,
      traits: {
        supportsApprovals: true,
        supportsFullAccess: true,
        supportsInterrupt: true,
        supportsSessionStop: true,
        supportsStreaming: true,
        supportsUserInput: false,
      },
    } satisfies Partial<ProviderSnapshot>
    if (!this.options.enabled)
      return { ...base, installed: false, status: 'disabled', auth: { status: 'unknown' } }
    const url = this.options.serverUrl ?? this.sessions.values().next().value?.server.currentUrl()
    if (!url) {
      const installed = Boolean(
        Bun.which(this.options.binaryPath ?? 'opencode', { PATH: this.options.env.PATH ?? '' }),
      )
      return {
        ...base,
        installed,
        status: 'warning',
        auth: { status: 'unknown' },
        message: installed
          ? 'OpenCode is available. Start a session to read its model catalog.'
          : 'Install OpenCode or configure its server URL.',
      }
    }
    try {
      const http = new OpenCodeHttp(url)
      const health = await http.request<{ version: string }>('/global/health', '')
      const catalog = await http.request<{
        connected: string[]
        all: { id: string; models: Record<string, { name: string }> }[]
      }>('/provider', '')
      const connected = new Set(catalog.connected)
      const models = catalog.all
        .filter((provider) => connected.has(provider.id))
        .flatMap((provider) =>
          Object.entries(provider.models).map(([id, model]) => ({
            slug: `${provider.id}/${id}`,
            name: model.name,
            isCustom: false,
            capabilities: null,
          })),
        )
      return {
        ...base,
        models,
        installed: true,
        status: 'ready',
        version: health.version,
        auth: { status: connected.size ? 'authenticated' : 'unauthenticated' },
      }
    } catch {
      return {
        ...base,
        installed: true,
        status: 'error',
        auth: { status: 'unknown' },
        message: 'OpenCode server could not be reached.',
      }
    }
  }

  async startRuntime(input: ProviderRuntimeStartInput): Promise<ProviderAdapterRuntime> {
    this.validateInput(input)
    const existing = this.sessions.get(input.sessionId)
    if (existing) {
      if (
        existing.turn ||
        existing.input.cwd !== input.cwd ||
        existing.input.runtimeEpoch !== input.runtimeEpoch
      )
        throw openCodeErrors.OPENCODE_SESSION_CONFLICT({ internal: { operation: 'reuse' } })
      await existing.http.request(
        `/session/${encodeURIComponent(existing.id)}`,
        input.cwd,
        { permission: permissions(input.runtimeMode) },
        'PATCH',
      )
      existing.input = input
      return this.runtime(existing)
    }
    const pending = this.starting.get(input.sessionId)
    if (pending)
      throw openCodeErrors.OPENCODE_SESSION_CONFLICT({
        internal: { operation: 'start-in-progress' },
      })
    const start = this.openSession(input)
    this.starting.set(input.sessionId, start)
    try {
      return await start
    } finally {
      this.starting.delete(input.sessionId)
    }
  }

  async sendTurn(input: ProviderTurnInput) {
    this.validateInput(input)
    if (input.attachments.length || input.kind === 'compact')
      throw openCodeErrors.OPENCODE_UNSUPPORTED({
        internal: { operation: input.kind === 'compact' ? 'compact' : 'attachments' },
      })
    let session = this.sessions.get(input.sessionId)
    if (!session) {
      await this.startRuntime(sessionInputFromTurn(input))
      session = this.sessions.get(input.sessionId)!
    }
    if (session.turn || session.input.runtimeEpoch !== input.runtimeEpoch)
      throw openCodeErrors.OPENCODE_SESSION_CONFLICT({ internal: { operation: 'turn' } })
    session.turn = input
    session.interrupting = null
    session.sawActivity = false
    session.assistantMessages.clear()
    session.parts.clear()
    session.partKinds.clear()
    this.emit(session, { type: 'turn.started', payload: { model: input.modelSelection.model } })
    const separator = input.modelSelection.model.indexOf('/')
    try {
      await session.http.request(
        `/session/${encodeURIComponent(session.id)}/prompt_async`,
        input.cwd,
        {
          model: {
            providerID: input.modelSelection.model.slice(0, separator),
            modelID: input.modelSelection.model.slice(separator + 1),
          },
          parts: [{ type: 'text', text: input.messageText }],
        },
      )
    } catch (error) {
      this.finish(session, 'failed')
      throw error
    }
  }

  async interruptTurn(input: ProviderTurnControlInput) {
    const session = this.sessions.get(input.sessionId)
    if (!session?.turn) return
    if (input.turnId && input.turnId !== session.turn.turnId) return
    const turn = session.turn
    session.interrupting = turn
    try {
      await session.http.request(
        `/session/${encodeURIComponent(session.id)}/abort`,
        session.input.cwd,
        {},
      )
    } catch (error) {
      if (session.interrupting === turn) session.interrupting = null
      throw error
    }
    if (session.turn === turn) this.finish(session, 'interrupted')
  }

  async stopRuntime(input: { sessionId: SessionId }) {
    await this.starting.get(input.sessionId)?.catch(() => undefined)
    const session = this.sessions.get(input.sessionId)
    if (!session) return
    try {
      await this.interruptTurn(input)
    } finally {
      session.controller.abort()
      await session.stream
      this.sessions.delete(input.sessionId)
      await session.server.close()
      this.emit(session, { type: 'runtime.exited', payload: { exitKind: 'graceful' } })
    }
  }

  async stopAll() {
    this.stopped = true
    await Promise.allSettled(this.starting.values())
    await Promise.allSettled(
      [...this.sessions.keys()].map((sessionId) => this.stopRuntime({ sessionId })),
    )
  }

  async respondApproval(input: ProviderApprovalResponseInput) {
    const session = this.sessions.get(input.sessionId)
    if (!session?.permissions.has(input.requestId))
      throw openCodeErrors.OPENCODE_SESSION_CONFLICT({ internal: { operation: 'approval' } })
    if (input.decision === 'acceptAlwaysInProject' || input.decision === 'acceptAlways')
      throw openCodeErrors.OPENCODE_UNSUPPORTED({ internal: { operation: 'persistent-approval' } })
    let reply = 'reject'
    if (input.decision === 'accept') reply = 'once'
    if (input.decision === 'acceptForSession') reply = 'always'
    await session.http.request(
      `/permission/${encodeURIComponent(input.requestId)}/reply`,
      session.input.cwd,
      { reply },
    )
    session.permissions.delete(input.requestId)
    this.emit(session, {
      type: 'request.resolved',
      requestId: input.requestId,
      payload: { requestType: 'permission', decision: input.decision },
    })
  }

  async respondUserInput() {
    throw openCodeErrors.OPENCODE_UNSUPPORTED({ internal: { operation: 'user-input' } })
  }
  async prepareRollbackSession(): Promise<() => Promise<void>> {
    throw openCodeErrors.OPENCODE_UNSUPPORTED({ internal: { operation: 'rollback' } })
  }

  private validateInput(input: ProviderRuntimeStartInput) {
    if (
      this.stopped ||
      !this.options.enabled ||
      input.providerInstanceId !== this.adapterKey ||
      input.modelSelection.providerInstanceId !== this.adapterKey
    )
      throw openCodeErrors.OPENCODE_SESSION_CONFLICT({ internal: { operation: 'instance' } })
    if (
      input.fork ||
      input.platformMcp ||
      input.outputSchema ||
      input.mcpOff?.length ||
      input.agent ||
      input.interactionMode === 'plan' ||
      !/^([^/]+)\/(.+)$/.test(input.modelSelection.model) ||
      Object.keys(input.modelSelection.options ?? {}).length
    )
      throw openCodeErrors.OPENCODE_UNSUPPORTED({ internal: { operation: 'runtime-options' } })
  }

  private async openSession(input: ProviderRuntimeStartInput) {
    const cursor = input.providerResumeCursor == null ? null : asRecord(input.providerResumeCursor)
    if (
      cursor &&
      (!stringField(cursor, 'sessionId') || cursor.providerInstanceId !== this.adapterKey)
    )
      throw openCodeErrors.OPENCODE_SESSION_CONFLICT({ internal: { operation: 'resume-owner' } })
    const server = new OpenCodeServer(this.options)
    try {
      return await this.connectSession(input, cursor, server)
    } catch (error) {
      await server.close().catch(() => undefined)
      throw error
    }
  }

  private async connectSession(
    input: ProviderRuntimeStartInput,
    cursor: { sessionId?: unknown; providerInstanceId?: unknown } | null,
    server: OpenCodeServer,
  ) {
    const http = new OpenCodeHttp(await server.start(input.cwd))
    const native = cursor
      ? await http.request<{ id: string; directory: string }>(
          `/session/${encodeURIComponent(cursor.sessionId as string)}`,
          input.cwd,
        )
      : await http.request<{ id: string; directory: string }>('/session', input.cwd, {
          permission: permissions(input.runtimeMode),
        })
    if (native.directory !== input.cwd)
      throw openCodeErrors.OPENCODE_UNSUPPORTED({ internal: { operation: 'resume-directory' } })
    if (cursor)
      await http.request(
        `/session/${encodeURIComponent(native.id)}`,
        input.cwd,
        { permission: permissions(input.runtimeMode) },
        'PATCH',
      )
    const controller = new AbortController()
    const stream = await http.events(input.cwd, controller.signal)
    const session: NativeSession = {
      input,
      id: native.id,
      http,
      server,
      controller,
      stream: Promise.resolve(),
      turn: null,
      interrupting: null,
      assistantMessages: new Set(),
      parts: new Map(),
      partKinds: new Map(),
      permissions: new Set(),
      sawActivity: false,
    }
    this.sessions.set(input.sessionId, session)
    session.stream = this.consume(session, stream)
    this.emit(session, {
      type: 'runtime.started',
      payload: { resume: this.runtime(session).providerResumeCursor },
    })
    return this.runtime(session)
  }

  private async consume(session: NativeSession, stream: ReadableStream<Uint8Array>) {
    try {
      await readOpenCodeEvents(stream, (event) => this.onEvent(session, event))
      if (!session.controller.signal.aborted)
        throw openCodeErrors.OPENCODE_REQUEST_FAILED({ internal: { operation: 'stream-eof' } })
    } catch {
      if (session.controller.signal.aborted) return
      this.emit(session, {
        type: 'runtime.error',
        payload: { message: 'OpenCode event stream closed.' },
      })
      this.finish(session, 'failed')
      this.sessions.delete(session.input.sessionId)
      await session.server.close().catch(() => undefined)
    }
  }

  private onEvent(session: NativeSession, event: unknown) {
    const native = asRecord(event)
    const p = asRecord(native.properties)
    const info = asRecord(p.info)
    const part = asRecord(p.part)
    const owner = p.sessionID ?? info.sessionID ?? part.sessionID
    if (owner !== session.id) return
    if (native.type === 'session.error') {
      this.emit(session, {
        type: 'runtime.error',
        payload: { message: 'OpenCode reported a session error.' },
      })
      this.finish(session, 'failed')
      return
    }
    if (native.type === 'session.status') {
      const status = asRecord(p.status).type
      if (status === 'busy') session.sawActivity = true
      if (status === 'idle' && session.sawActivity)
        this.finish(session, session.interrupting === session.turn ? 'interrupted' : 'completed')
      return
    }
    if (!session.turn) return
    const messageId = stringField(info, 'id')
    if (native.type === 'message.updated' && info.role === 'assistant' && messageId)
      session.assistantMessages.add(messageId)
    if (
      native.type === 'message.part.delta' &&
      typeof p.messageID === 'string' &&
      session.assistantMessages.has(p.messageID) &&
      typeof p.partID === 'string' &&
      typeof p.delta === 'string' &&
      p.field === 'text'
    ) {
      const previous = session.parts.get(p.partID) ?? ''
      session.parts.set(p.partID, previous + p.delta)
      this.emit(session, {
        type: 'content.delta',
        itemId: p.messageID,
        payload: {
          streamKind: session.partKinds.get(p.partID) ?? 'assistant_text',
          delta: p.delta,
        },
      })
    }
    if (native.type === 'message.part.updated') this.partUpdated(session, part)
    if (native.type === 'permission.asked') this.permissionAsked(session, p)
    const requestId = stringField(p, 'id')
    if (native.type === 'question.asked' && requestId) {
      void session.http
        .request(`/question/${encodeURIComponent(requestId)}/reject`, session.input.cwd, {})
        .catch(() => this.finish(session, 'failed'))
      this.emit(session, {
        type: 'runtime.warning',
        payload: {
          message:
            'OpenCode user input is unavailable. Ask the agent to continue with a text question.',
        },
      })
    }
  }

  private partUpdated(session: NativeSession, part: Record<string, unknown>) {
    const id = stringField(part, 'id')
    const messageId = stringField(part, 'messageID')
    if (!id || !messageId || !session.assistantMessages.has(messageId)) return
    session.sawActivity = true
    if (part.type === 'text' || part.type === 'reasoning') {
      session.partKinds.set(id, part.type === 'text' ? 'assistant_text' : 'reasoning_text')
      const previous = session.parts.get(id) ?? ''
      const text = typeof part.text === 'string' ? part.text : ''
      if (text.startsWith(previous) && text.length > previous.length)
        this.emit(session, {
          type: 'content.delta',
          itemId: messageId,
          payload: {
            streamKind: part.type === 'text' ? 'assistant_text' : 'reasoning_text',
            delta: text.slice(previous.length),
          },
        })
      session.parts.set(id, text)
      return
    }
    if (part.type !== 'tool') return
    const state = asRecord(part.state)
    const terminal = state.status === 'completed' || state.status === 'error'
    let status: 'completed' | 'failed' | 'inProgress' = terminal ? 'completed' : 'inProgress'
    if (state.status === 'error') status = 'failed'
    this.emit(session, {
      type: terminal ? 'item.completed' : 'item.started',
      itemId: id,
      payload: {
        itemType: 'tool',
        title: stringField(part, 'tool') ?? 'Tool',
        data: state,
        status,
      },
    })
  }

  private permissionAsked(session: NativeSession, permission: Record<string, unknown>) {
    const requestId = stringField(permission, 'id')
    if (!requestId) return
    if (session.input.runtimeMode === 'full-access') {
      void session.http
        .request(`/permission/${encodeURIComponent(requestId)}/reply`, session.input.cwd, {
          reply: 'once',
        })
        .catch(() => this.finish(session, 'failed'))
      return
    }
    session.permissions.add(requestId)
    this.emit(session, {
      type: 'request.opened',
      requestId,
      payload: {
        requestType: 'permission',
        detail:
          'Allow for workspace grants matching requests in every OpenCode session in this workspace.',
        args: { permission: permission.permission, patterns: permission.patterns },
        options: [
          { decision: 'accept', label: 'Allow once' },
          { decision: 'acceptForSession', label: 'Allow for workspace' },
          { decision: 'decline', label: 'Decline' },
        ],
      },
    })
  }

  private finish(session: NativeSession, state: 'completed' | 'failed' | 'interrupted') {
    if (!session.turn) return
    this.emit(session, { type: 'turn.completed', payload: { state } })
    session.turn = null
    session.interrupting = null
    session.permissions.clear()
    session.sawActivity = false
  }

  private runtime(session: NativeSession): ProviderAdapterRuntime {
    return {
      runtimeEpoch: session.input.runtimeEpoch,
      cwd: session.input.cwd,
      model: session.input.modelSelection.model,
      providerInstanceId: this.adapterKey,
      providerBindingHandle: session.id,
      providerConversationMarker: session.id,
      providerResumeCursor: { sessionId: session.id, providerInstanceId: this.adapterKey },
      runtimeMode: session.input.runtimeMode,
      status: session.turn ? 'running' : 'ready',
      sessionId: session.input.sessionId,
    }
  }

  private emit(session: NativeSession, event: Record<string, unknown>) {
    this.events.publish({
      createdAt: new Date().toISOString(),
      eventId: crypto.randomUUID(),
      provider: this.driverKind,
      providerInstanceId: this.adapterKey,
      providerName: this.options.displayLabel,
      runtimeEpoch: session.input.runtimeEpoch,
      sessionId: session.input.sessionId,
      ...(session.turn ? { turnId: session.turn.turnId } : {}),
      ...event,
    } as ProviderRuntimeEvent)
  }
}

function permissions(mode: ProviderRuntimeStartInput['runtimeMode']) {
  if (mode === 'full-access')
    return ['*', 'external_directory'].map((permission) => ({
      permission,
      pattern: '*',
      action: 'allow',
    }))
  const rules = [{ permission: '*', pattern: '*', action: 'ask' }]
  for (const permission of ['read', 'glob', 'grep', 'lsp', 'skill', 'todowrite'])
    rules.push({ permission, pattern: '*', action: 'allow' })
  rules.push(
    { permission: 'read', pattern: '*.env', action: 'ask' },
    { permission: 'read', pattern: '*.env.*', action: 'ask' },
    { permission: 'read', pattern: '*.env.example', action: 'allow' },
    { permission: 'edit', pattern: '*', action: mode === 'auto-accept-edits' ? 'allow' : 'ask' },
  )
  return rules
}
