import { treaty } from '@elysia/eden'
import type { QueryClient } from '@tanstack/react-query'
import type { App } from 'server/client-contract'

import { activeServerOrigin, getClient, setClient } from '@/lib/client'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { clientInstanceId, instanceHeaderName } from '@/lib/instance-id'

export type DelayedFileReadClient = {
  readonly observedMetadataStatus: () => number | null
  readonly observedStatus: () => number | null
  readonly release: () => void
  readonly releaseMetadata: () => void
  readonly restore: () => void
}

// Queries that resolve through the environment registry snapshot their client,
// so swapping the process-wide one is not enough: pass the query client whose
// reads should pass through the gate.
export function installDelayedFileReadClient(
  queryClient?: QueryClient,
  { delayMetadata = false }: { readonly delayMetadata?: boolean } = {},
): DelayedFileReadClient {
  const previousClient = getClient()
  const gate = createDelayedReadGate()
  const metadataGate = createDelayedReadGate()
  const fetcher = Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const response = await fetch(...args)
      const pathname = new URL(requestUrl(args[0])).pathname
      if (pathname === '/fs/stat' && delayMetadata) await metadataGate.hold(response.status)
      if (pathname !== '/fs/read') return response

      await gate.hold(response.status)
      return response
    },
    { preconnect: fetch.preconnect },
  )
  const gatedClient = treaty<App>(activeServerOrigin(), {
    fetcher,
    headers: () => ({ [instanceHeaderName]: clientInstanceId() }),
  })
  setClient(gatedClient)
  if (queryClient) registerEnvironmentQueryClient(queryClient, activeServerOrigin(), gatedClient)

  let restored = false
  return {
    observedMetadataStatus: metadataGate.observedStatus,
    observedStatus: gate.observedStatus,
    release: () => {
      gate.release()
      metadataGate.release()
    },
    releaseMetadata: metadataGate.release,
    restore: () => {
      gate.release()
      metadataGate.release()
      if (restored) return

      restored = true
      setClient(previousClient)
      if (queryClient) {
        registerEnvironmentQueryClient(queryClient, activeServerOrigin(), previousClient)
      }
    },
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function createDelayedReadGate() {
  let observedStatus: number | null = null
  let released = false
  let releaseWait: () => void = () => undefined
  const wait = new Promise<void>((resolve) => {
    releaseWait = resolve
  })

  return {
    hold: (status: number) => {
      observedStatus = status
      return wait
    },
    observedStatus: () => observedStatus,
    release: () => {
      if (released) return

      released = true
      releaseWait()
    },
  }
}
