import {
  PagedDocument,
  PagedSourceInvalidatedError,
  PAGED_PROOF_OPTIONS,
} from '@singapore-editor/paged'
import { errorStringField } from '@workspace/contracts'
import {
  queryOptions,
  mutationOptions,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { openFileReadSession } from '@workspace/client-core/files/read-session'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { runMutation } from '@/lib/mutations/run'
import { log } from '@/lib/client-logging'
import { pagedFileQueryKeys } from '@/features/workbench/utils/query-keys'
import { workbenchMutationKeys } from '@/features/workbench/utils/mutation-keys'

export function pagedResourceOptions(instance: string, path: string, generation: number) {
  const queryKey = pagedFileQueryKeys.resource(instance, path, generation)
  return queryOptions({
    queryKey,
    queryFn: async ({ client, signal }) => {
      const source = await openFileReadSession({
        client: clientForQueryClient(client),
        path,
        signal,
      })
      const document = new PagedDocument(pagedSource(source), {
        ...PAGED_PROOF_OPTIONS,
        pageBytes: Math.min(source.maxRangeBytes, PAGED_PROOF_OPTIONS.pageBytes),
      })
      const view = document.createView()
      const resource = { source, document, view }
      releaseWhenRemoved(client, queryKey, resource)
      return resource
    },
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    structuralSharing: false,
  })
}

export type PagedResource = {
  source: Awaited<ReturnType<typeof openFileReadSession>>
  document: PagedDocument
  view: ReturnType<PagedDocument['createView']>
}

function pagedSource(source: PagedResource['source']) {
  return {
    ...source,
    async readBytes(start: number, end: number, signal: AbortSignal) {
      try {
        return await source.readBytes(start, end, signal)
      } catch (error) {
        const code = errorStringField(error, 'code')
        if (
          code === 'FILE_CHANGED' ||
          code === 'READ_SESSION_EXPIRED' ||
          code === 'FILE_RANGE_INCOMPLETE'
        )
          throw new PagedSourceInvalidatedError(error)
        throw error
      }
    },
  }
}

// A refetch (server restart invalidation) replaces the data without removing the query, so the
// resource also releases itself once the query holds a newer one.
function releaseWhenRemoved(client: QueryClient, queryKey: QueryKey, resource: PagedResource) {
  const cache = client.getQueryCache()
  const query = cache.find({ queryKey, exact: true })
  let held = false
  const unsubscribe = cache.subscribe((event) => {
    if (event.query !== query) return
    const data: unknown = event.query.state.data
    if (data === resource) held = true
    const replaced = held && data !== resource
    if (event.type !== 'removed' && !replaced) return
    unsubscribe()
    resource.view.dispose()
    resource.document.dispose()
    client.removeQueries({ queryKey: pagedFileQueryKeys.index(resource.source.id) })
    client.removeQueries({ queryKey: pagedFileQueryKeys.pages(resource.source.id) })
    void runMutation(
      client,
      mutationOptions({
        mutationKey: workbenchMutationKeys.releaseReadSession(resource.source.id),
        mutationFn: () => resource.source.dispose(),
        gcTime: 0,
        retry: false,
      }),
      undefined,
    ).catch((error: unknown) =>
      log.warn({ area: 'fs', action: 'fs.read_session_close_failed', error }),
    )
  })
}

export async function readPagedWindow(owned: PagedResource, line: number, signal: AbortSignal) {
  signal.throwIfAborted()
  const window = await owned.view.readLines(line, PAGED_PROOF_OPTIONS.maxWindowRows, signal)
  signal.throwIfAborted()
  return { ...window, firstLine: line, byteLength: owned.source.byteLength }
}
