import type { ProviderUsagePurpose } from '@workspace/contracts'
import type {
  ChatAttachment,
  ModelSelection,
  ProviderInstanceId,
  SessionId,
  TurnId,
} from '@workspace/contracts'

import type { ProviderRuntimeEvent } from './types'

export type ProviderTextGenerationInput = {
  attachments?: readonly ChatAttachment[]
  attachmentsDir?: string
  messageText: string
  modelSelection: ModelSelection
  /** What the generation is for; its usage is recorded under this. */
  purpose: Exclude<ProviderUsagePurpose, 'turn'>
  signal?: AbortSignal
}

export type ProviderTextGenerationResult = {
  text: string
}

export type ProviderTextGenerationOutcome = {
  errorMessage: string | null
  interactionRequired: boolean
  state: 'cancelled' | 'completed' | 'failed' | 'interrupted' | null
  text: string
}

type InterruptTextGeneration = () => Promise<void>

/** Collects one isolated provider turn without projecting it into a chat conversation. */
export class ProviderTextGenerationTask {
  readonly providerInstanceId: ProviderInstanceId
  readonly purpose: ProviderUsagePurpose
  readonly sessionId: SessionId
  readonly turnId: TurnId
  private canonicalText = ''
  private fallbackText = ''
  private interactionRequired = false
  private readonly interruptTextGeneration: InterruptTextGeneration
  private runtimeError: string | null = null
  private state: ProviderTextGenerationOutcome['state'] = null
  private streamedText = ''

  constructor(input: {
    interrupt: InterruptTextGeneration
    providerInstanceId: ProviderInstanceId
    purpose: ProviderUsagePurpose
    sessionId: SessionId
    turnId: TurnId
  }) {
    this.interruptTextGeneration = input.interrupt
    this.providerInstanceId = input.providerInstanceId
    this.purpose = input.purpose
    this.sessionId = input.sessionId
    this.turnId = input.turnId
  }

  accept(event: ProviderRuntimeEvent) {
    if (event.sessionId !== this.sessionId) return false

    if (event.type === 'assistant.delta') this.canonicalText += event.delta
    if (event.type === 'content.delta' && event.payload.streamKind === 'assistant_text') {
      this.streamedText += event.payload.delta
    }
    if (event.type === 'item.completed' && event.payload.itemType === 'assistant_message') {
      this.fallbackText = event.payload.detail ?? this.fallbackText
    }
    if (event.type === 'runtime.error') this.runtimeError = event.payload.message
    if (event.type === 'turn.completed') {
      this.state = event.payload.state
      this.runtimeError = event.payload.errorMessage ?? this.runtimeError
    }
    if (!requiresInteraction(event)) return false

    this.interactionRequired = true
    return true
  }

  interrupt() {
    return this.interruptTextGeneration()
  }

  outcome(): ProviderTextGenerationOutcome {
    return {
      errorMessage: this.runtimeError,
      interactionRequired: this.interactionRequired,
      state: this.state,
      text: generatedText(this.canonicalText, this.streamedText, this.fallbackText),
    }
  }
}

function generatedText(canonicalText: string, streamedText: string, fallbackText: string) {
  if (canonicalText.trim().length > 0) return canonicalText
  if (streamedText.trim().length > 0) return streamedText

  return fallbackText
}

function requiresInteraction(event: ProviderRuntimeEvent) {
  if (event.type === 'request.opened') return true
  if (event.type === 'user-input.requested') return true

  return false
}
