import { clientInstanceId } from '@/lib/instance-id'
import { eventLogContext } from '@/lib/environments/state/log-context'
import {
  createWideEventScope as createScope,
  type WideEventBase,
} from '@workspace/observability/scope'

import { clientLoggingEnabled, log } from '@/lib/client-logging'

let scopeSequence = 0

export function createWideEventScope(base: WideEventBase) {
  const enabled = clientLoggingEnabled()
  if (!enabled) return createScope({ enabled: false, base })
  return createScope({
    enabled,
    base: {
      ...eventLogContext(base),
      ...base,
      runtime: 'browser',
      scopeId:
        globalThis.crypto?.randomUUID?.() ?? `${clientInstanceId()}:scope:${++scopeSequence}`,
    },
    onFailure: (level, context) => log[level](() => ({ ...context, checkpoint: 'failure' })),
  })
}
