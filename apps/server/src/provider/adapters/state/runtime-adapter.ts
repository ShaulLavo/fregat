import type { SessionId } from '@workspace/contracts'
import { createInternalError } from '../../../observability/structured-errors'
import { ProviderRuntimeEventStream } from '../../provider-runtime-event-stream'
import type {
  ProviderAdapterRuntime,
  ProviderApprovalResponseInput,
  ProviderRuntimeEvent,
  ProviderRuntimeStartInput,
  ProviderUserInputResponseInput,
} from '../../types'

type RuntimeSession = {
  isActive(): boolean
  snapshot(): ProviderAdapterRuntime
  respondApproval(input: ProviderApprovalResponseInput): Promise<void>
  respondUserInput(input: ProviderUserInputResponseInput): Promise<void>
}

export abstract class RuntimeAdapter<Session extends RuntimeSession> {
  protected readonly events = new ProviderRuntimeEventStream()
  protected readonly sessions = new Map<SessionId, Session>()
  private readonly provider: string
  private readonly sessionNoun: 'session' | 'thread'

  protected constructor(provider: string, sessionNoun: 'session' | 'thread') {
    this.provider = provider
    this.sessionNoun = sessionNoun
  }

  protected abstract ensureRuntimeSession(input: ProviderRuntimeStartInput): Promise<Session>

  subscribeEvents(subscriber: (event: ProviderRuntimeEvent) => void) {
    return this.events.subscribe(subscriber)
  }

  async startRuntime(input: ProviderRuntimeStartInput) {
    const session = await this.ensureRuntimeSession(input)
    return session.snapshot()
  }

  async respondApproval(input: ProviderApprovalResponseInput) {
    await this.requireSession(input.sessionId, 'approval/respond').respondApproval(input)
  }

  async respondUserInput(input: ProviderUserInputResponseInput) {
    await this.requireSession(input.sessionId, 'user-input/respond').respondUserInput(input)
  }

  protected requireSession(sessionId: SessionId, operation: string) {
    const session = this.sessions.get(sessionId)
    if (session?.isActive()) return session
    throw createInternalError(
      `${this.provider} ${operation} requires an active session for ${this.sessionNoun} ${sessionId}.`,
    )
  }
}
