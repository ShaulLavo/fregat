import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { pdfQueryKeys } from '@/lib/pdf-viewer/query-keys'
import { pdfMutationKeys } from '@/lib/pdf-viewer/mutation-keys'
import { pdfError } from '@/lib/pdf-viewer/structured-errors'
import { runMutation } from '@/lib/mutations/run'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

type Presentation = typeof import('@/components/pdf-viewer/presentation-content')
const loadPresentation = mutationOptions({
  mutationKey: pdfMutationKeys.presentation,
  scope: { id: 'pdf-presentation' },
  networkMode: 'always',
  mutationFn: async () => {
    const cached = resourceQueryClient.getQueryData<Presentation>(pdfQueryKeys.presentation)
    if (cached) return cached
    try {
      return await import('@/components/pdf-viewer/presentation-content')
    } catch (cause) {
      throw pdfError('ENGINE_UNAVAILABLE', cause, 'import')
    }
  },
  onSuccess: (presentation) => {
    resourceQueryClient.setQueryData(pdfQueryKeys.presentation, presentation)
  },
})

export const pdfPresentationOptions = queryOptions({
  queryKey: pdfQueryKeys.presentation,
  staleTime: 'static',
  gcTime: Infinity,
  structuralSharing: false,
  networkMode: 'always',
  retry: false,
  queryFn: () => runMutation(resourceQueryClient, loadPresentation, undefined),
})
