import { EmptyState } from '@workspace/ui/components/empty-state'
import { errorMessage } from '@/lib/error-message'

export function PdfFailure({ error }: { error: unknown }) {
  const data = error && typeof error === 'object' && 'data' in error ? error.data : null
  const fix =
    data && typeof data === 'object' && 'fix' in data && typeof data.fix === 'string'
      ? data.fix
      : 'Reopen the PDF to try again.'
  return (
    <EmptyState
      tone='error'
      title={errorMessage(error, 'The PDF could not be opened')}
      description={fix}
    />
  )
}
