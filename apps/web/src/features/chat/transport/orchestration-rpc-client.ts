import { environmentLogContext } from '@/lib/environments/state/log-context'
import { serverEndpoint } from '@/lib/client'
import { simulateLatency } from '@/lib/simulated-latency'
import {
  OrchestrationRpcClient,
  type OrchestrationRpcClientOptions,
} from '@workspace/client-core/transport/orchestration-rpc-client'

import { observeClientOperation } from '@/lib/client-logging'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { clientInstanceId, instanceQueryParam } from '@/lib/instance-id'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createRpcEventScope } from '@/features/chat/transport/rpc-event-scope'
import { windowPresence } from '@/features/chat/transport/window-presence'

export type WebOrchestrationRpcClientOptions = Omit<
  OrchestrationRpcClientOptions,
  'environments' | 'observation' | 'createSocket' | 'beforeConnect'
> & { readonly createSocket?: OrchestrationRpcClientOptions['createSocket'] }

export function createOrchestrationRpcClient(options: WebOrchestrationRpcClientOptions) {
  return new OrchestrationRpcClient({
    ...options,
    beforeRequest: simulateLatency,
    presence: windowPresence,
    beforeConnect: untilPageShows,
    createSocket: options.createSocket ?? openSocket,
    resolveEndpoint: serverEndpoint,
    environments: useEnvironmentsStore,
    observation: {
      observeOperation: (event, operation, summarize) =>
        observeClientOperation(
          { ...environmentLogContext(options.origin), ...event },
          operation,
          summarize,
        ),
      createScope: (event) =>
        createRpcEventScope({ ...environmentLogContext(options.origin), ...event }),
    },
  })
}

// The server tags its socket events with this tab's id; a browser socket cannot send headers.
function openSocket(address: string) {
  const url = new URL(address)
  url.searchParams.set(instanceQueryParam, clientInstanceId())

  return new WebSocket(url)
}

/** The browser drops a hidden page's sockets at its next timer wake, so a new one waits to be seen. */
function untilPageShows(signal: AbortSignal): Promise<void> | undefined {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return undefined
  // Session notifications arrive over the shell stream, and a hidden page is who they are for.
  if (readSettingsMirror()['chat.notificationMode'] !== 'off') return undefined

  return new Promise((resolve) => {
    const settle = () => {
      document.removeEventListener('visibilitychange', visible)
      signal.removeEventListener('abort', settle)
      resolve()
    }
    const visible = () => {
      if (document.visibilityState !== 'hidden') settle()
    }
    document.addEventListener('visibilitychange', visible)
    signal.addEventListener('abort', settle, { once: true })
  })
}
