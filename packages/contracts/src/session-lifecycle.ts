import * as v from 'valibot'
import { sessionIdSchema, commandIdSchema } from './chat-ids'
import {
  isoDateTimeSchema,
  nonNegativeIntegerSchema,
  orderKeySchema,
  sessionSettledOverrideSchema,
} from './chat-model'

export const sessionLifecycleStateSchema = v.object({
  archivedAt: v.nullable(isoDateTimeSchema),
  settledOverride: v.nullable(sessionSettledOverrideSchema),
  settledAt: v.nullable(isoDateTimeSchema),
  unsettledAt: v.nullable(isoDateTimeSchema),
  snoozedUntil: v.nullable(isoDateTimeSchema),
  snoozedAt: v.nullable(isoDateTimeSchema),
  pinnedAt: v.nullable(isoDateTimeSchema),
  pinOrderKey: v.nullable(orderKeySchema),
  activeOrderKey: v.nullable(orderKeySchema),
  acknowledgedFailureThroughSequence: v.nullable(nonNegativeIntegerSchema),
})

export const sessionLifecycleResultSchema = v.object({
  kind: v.literal('session.lifecycle'),
  commandId: commandIdSchema,
  sessionId: sessionIdSchema,
  beforeRevision: nonNegativeIntegerSchema,
  before: sessionLifecycleStateSchema,
})
export type SessionLifecycleState = v.InferOutput<typeof sessionLifecycleStateSchema>
export type SessionLifecycleResult = v.InferOutput<typeof sessionLifecycleResultSchema>

const lifecycleCommandTypes: readonly string[] = [
  'session.archive',
  'session.unarchive',
  'session.settle',
  'session.unsettle',
  'session.snooze',
  'session.unsnooze',
  'session.pin',
  'session.unpin',
  'session.active.reorder',
  'session.pin.reorder',
  'session.lifecycle.restore',
]
export function isSessionLifecycleCommand(type: string) {
  return lifecycleCommandTypes.includes(type)
}
