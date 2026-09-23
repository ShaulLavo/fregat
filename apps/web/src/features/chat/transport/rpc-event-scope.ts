import type { RpcEvent } from '@workspace/client-core/transport/rpc-host'

import { createWideEventScope } from '@/lib/wide-event-scope'

export function createRpcEventScope(event: RpcEvent) {
  const scope = createWideEventScope({ ...event, browserAtStart: browserState() })

  return {
    ...scope,
    end(overrides?: Record<string, unknown>) {
      scope.end({ ...overrides, browserAtEnd: browserState() })
    },
  }
}

function browserState() {
  return {
    visibility: typeof document === 'undefined' ? null : document.visibilityState,
    focused: typeof document === 'undefined' ? null : document.hasFocus(),
    online: typeof navigator === 'undefined' ? null : navigator.onLine,
  }
}
