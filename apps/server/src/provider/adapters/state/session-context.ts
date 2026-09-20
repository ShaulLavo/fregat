import type {
  ProviderRuntimeEvent,
  ProviderRuntimeEventPayload,
  ProviderRuntimeStartInput,
} from '../../types'

type SessionContextInput = Pick<
  ProviderRuntimeStartInput,
  'cwd' | 'providerInstanceId' | 'runtimeMode' | 'runtimeEpoch' | 'sessionId'
> & {
  emit: (event: ProviderRuntimeEvent) => void
  ephemeral: boolean
  model: string
}

export abstract class SessionContext {
  protected readonly cwd: string
  protected readonly emit: (event: ProviderRuntimeEventPayload) => void
  protected readonly ephemeral: boolean
  protected readonly model: string
  protected readonly providerInstanceId: SessionContextInput['providerInstanceId']
  protected readonly runtimeMode: SessionContextInput['runtimeMode']
  protected readonly runtimeEpoch: string
  protected readonly sessionId: SessionContextInput['sessionId']

  protected constructor(input: SessionContextInput) {
    this.cwd = input.cwd
    this.emit = (event) => input.emit({ ...event, runtimeEpoch: input.runtimeEpoch })
    this.ephemeral = input.ephemeral
    this.model = input.model
    this.providerInstanceId = input.providerInstanceId
    this.runtimeMode = input.runtimeMode
    this.runtimeEpoch = input.runtimeEpoch
    this.sessionId = input.sessionId
  }
}
