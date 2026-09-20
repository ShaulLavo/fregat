import { decideOrchestrationCommand } from '../../decider'
import { ProviderRuntimeIngestion } from '../../provider-runtime-ingestion'
import type { ResponseStreamingMode } from '../../response-delivery'
import type { ProviderTurnInput } from '../../../provider/types'
import {
  applyIncrementally,
  createProjectionFixture,
  messageSentEvent,
  pendingEvent,
  sessionBootstrapEvents,
  turnStartEvent,
} from './projection'

export function createNativeSessionProjection(
  input: ProviderTurnInput,
  responseStreamingMode: ResponseStreamingMode = 'paragraph',
) {
  const projection = createProjectionFixture()
  const createdAt = new Date(Date.now() - 60_000).toISOString()
  const providerStart = {
    sessionId: input.sessionId,
    turnId: input.turnId,
    generation: 1,
    runtimeEpoch: input.runtimeEpoch,
    createdAt,
  }
  let model = applyIncrementally(projection, [
    ...sessionBootstrapEvents(createdAt),
    messageSentEvent({
      messageId: `message-user-${input.turnId}`,
      turnId: input.turnId,
      role: 'user',
      streaming: false,
      text: input.messageText,
      createdAt,
    }),
    turnStartEvent(input.turnId, createdAt),
    pendingEvent('session.provider-start-claimed', providerStart, createdAt),
    pendingEvent('session.provider-start-adopted', providerStart, createdAt),
  ])
  const ingestion = new ProviderRuntimeIngestion(
    async (command) => {
      const events = projection.append(decideOrchestrationCommand(command, model))
      projection.pipeline.applyEvents(events)
      model = projection.snapshots.refreshReadModel(model, events)
    },
    { getReadModel: () => model, responseStreamingMode: () => responseStreamingMode },
  )
  return {
    ingestion,
    close: projection.close,
    snapshot: () => projection.snapshots.sessionDetailSnapshot(input.sessionId),
  }
}
