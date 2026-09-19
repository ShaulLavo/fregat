import { environmentLogContext } from '@/lib/environments/state/log-context'
import { serverEndpoint } from '@/lib/client'
import { simulateLatency } from '@/lib/simulated-latency'
import {
  OrchestrationRpcClient,
  type OrchestrationRpcClientOptions,
} from '@workspace/client-core/transport/orchestration-rpc-client'

import { observeClientOperation } from '@/lib/client-logging'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createWideEventScope } from '@/lib/wide-event-scope'

export type WebOrchestrationRpcClientOptions = Omit<
  OrchestrationRpcClientOptions,
  'environments' | 'observation' | 'createSocket'
> & { readonly createSocket?: OrchestrationRpcClientOptions['createSocket'] }

export function createOrchestrationRpcClient(options: WebOrchestrationRpcClientOptions) {
  return new OrchestrationRpcClient({
    ...options,
    beforeRequest: simulateLatency,
    createSocket: options.createSocket ?? ((address) => new WebSocket(address)),
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
        createWideEventScope({ ...environmentLogContext(options.origin), ...event }),
    },
  })
}
