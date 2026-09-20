import type { OrchestrationReplayEventsInput } from './index'
export function orchestrationReplaySummary(input: OrchestrationReplayEventsInput) {
  return {
    afterSequence: input.afterSequence,
    aggregateId: input.aggregateId,
    aggregateKind: input.aggregateKind,
    sessionId: input.sessionId,
  }
}
