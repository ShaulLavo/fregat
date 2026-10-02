import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query'
import { pdfError } from '@/lib/pdf-viewer/structured-errors'
import { runMutation } from '@/lib/mutations/run'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { pdfQueryKeys } from '@/lib/pdf-viewer/query-keys'
import { pdfMutationKeys } from '@/lib/pdf-viewer/mutation-keys'

type Engine = typeof import('@/lib/pdf-viewer/engine')
function pdfEngineMutationOptions(client: QueryClient) {
  return mutationOptions({
    mutationKey: pdfMutationKeys.engine,
    scope: { id: 'pdf-engine' },
    networkMode: 'always',
    mutationFn: async () => {
      const cached = client.getQueryData<Engine>(pdfQueryKeys.engine)
      if (cached) return cached
      try {
        return await import('@/lib/pdf-viewer/engine')
      } catch (cause) {
        throw pdfError('ENGINE_UNAVAILABLE', cause, 'import')
      }
    },
    onSuccess: (engine) => {
      client.setQueryData(pdfQueryKeys.engine, engine)
    },
  })
}

export const pdfEngineOptions = queryOptions({
  queryKey: pdfQueryKeys.engine,
  staleTime: 'static',
  gcTime: Infinity,
  structuralSharing: false,
  networkMode: 'always',
  retry: false,
  queryFn: () =>
    runMutation(resourceQueryClient, pdfEngineMutationOptions(resourceQueryClient), undefined),
})
