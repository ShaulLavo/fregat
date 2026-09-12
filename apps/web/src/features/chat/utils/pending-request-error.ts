import type { CommandId, OrchestrationSessionActivity } from '@workspace/contracts'
import * as v from 'valibot'

const responseFailure = v.object({ commandId: v.string(), detail: v.optional(v.string()) })

export function pendingRequestError(
  activities: readonly OrchestrationSessionActivity[],
  commandId: CommandId,
) {
  for (const activity of activities.toReversed()) {
    if (
      activity.kind !== 'provider.approval.respond.failed' &&
      activity.kind !== 'provider.user-input.respond.failed'
    )
      continue
    const parsed = v.safeParse(responseFailure, activity.payload)
    if (parsed.success && parsed.output.commandId === commandId)
      return parsed.output.detail ?? activity.summary
  }
  return null
}
