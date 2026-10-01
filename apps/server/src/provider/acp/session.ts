import * as v from 'valibot'
import { AcpPeer, type AcpPeerInput } from './peer'
import { acpErrors } from './structured-errors'

const initializeSchema = v.object({
  protocolVersion: v.literal(1),
  agentCapabilities: v.optional(
    v.object({
      loadSession: v.optional(v.boolean()),
      sessionCapabilities: v.optional(v.object({ resume: v.optional(v.unknown()) })),
    }),
    {},
  ),
  authMethods: v.optional(v.array(v.object({ id: v.string() })), []),
})
const newSessionSchema = v.object({ sessionId: v.pipe(v.string(), v.minLength(1)) })
const promptResponseSchema = v.object({ stopReason: v.string() })

export type AcpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource_link'; uri: string; name: string; mimeType?: string }

export type AcpSessionInput = AcpPeerInput & {
  resume?: { sessionId: string; method: 'load' | 'resume' }
  clientCapabilities?: Record<string, unknown>
  mcpServers?: readonly unknown[]
  authenticate?: (methods: readonly { id: string }[]) => string | undefined
  signal: AbortSignal
}

/** One native session per process keeps cancellation and permission routing local. */
export class AcpSession {
  readonly peer: AcpPeer
  readonly sessionId: string
  private activePrompt: Promise<string> | null = null

  private constructor(peer: AcpPeer, sessionId: string) {
    this.peer = peer
    this.sessionId = sessionId
  }

  static async open(input: AcpSessionInput): Promise<AcpSession> {
    let replaying = Boolean(input.resume)
    const peer = new AcpPeer({
      ...input,
      onNotification: (method, params) => {
        if (replaying && method === 'session/update') return
        input.onNotification?.(method, params)
      },
    })
    try {
      const initialized = v.parse(
        initializeSchema,
        await peer.request(
          'initialize',
          {
            protocolVersion: 1,
            clientCapabilities: input.clientCapabilities ?? {},
            clientInfo: { name: 'fregat', title: 'Fregat' },
          },
          input.signal,
        ),
      )
      const methodId = input.authenticate?.(initialized.authMethods)
      if (methodId) await peer.request('authenticate', { methodId }, input.signal)
      const params = { cwd: input.cwd, mcpServers: input.mcpServers ?? [] }
      if (!input.resume) {
        const session = v.parse(
          newSessionSchema,
          await peer.request('session/new', params, input.signal),
        )
        return new AcpSession(peer, session.sessionId)
      }
      const capabilities = initialized.agentCapabilities
      const supported =
        input.resume.method === 'load'
          ? capabilities.loadSession === true
          : capabilities.sessionCapabilities?.resume !== undefined
      if (!supported)
        throw acpErrors.RESUME_UNSUPPORTED({ internal: { operation: input.resume.method } })
      await peer.request(
        `session/${input.resume.method}`,
        {
          ...params,
          sessionId: input.resume.sessionId,
        },
        input.signal,
      )
      replaying = false
      return new AcpSession(peer, input.resume.sessionId)
    } catch (error) {
      await peer.dispose()
      if (v.isValiError(error))
        throw acpErrors.PROTOCOL({ internal: { reason: 'session-response' } })
      throw error
    }
  }

  prompt(content: readonly AcpContent[], signal: AbortSignal): Promise<string> {
    if (this.activePrompt)
      return Promise.reject(acpErrors.BUSY({ internal: { operation: 'session/prompt' } }))
    const prompt = this.peer
      .request(
        'session/prompt',
        {
          sessionId: this.sessionId,
          prompt: content,
        },
        signal,
      )
      .then((result) => {
        const parsed = v.safeParse(promptResponseSchema, result)
        if (!parsed.success) throw acpErrors.PROTOCOL({ internal: { reason: 'prompt-response' } })
        return parsed.output.stopReason
      })
    this.activePrompt = prompt
    void prompt.then(
      () => this.clearPrompt(prompt),
      () => this.clearPrompt(prompt),
    )
    return prompt
  }

  /** ACP cancellation is a notification; the original prompt response is the drain barrier. */
  async cancel() {
    const prompt = this.activePrompt
    if (!prompt) return
    this.peer.notify('session/cancel', { sessionId: this.sessionId })
    await prompt.catch(() => undefined)
  }

  request(method: string, params: Record<string, unknown>, signal: AbortSignal) {
    return this.peer.request(method, { ...params, sessionId: this.sessionId }, signal)
  }

  dispose() {
    return this.peer.dispose()
  }

  private clearPrompt(prompt: Promise<string>) {
    if (this.activePrompt === prompt) this.activePrompt = null
  }
}
