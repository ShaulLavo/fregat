import { clientErrorMetadata } from '@/lib/client-error-context'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { reportClientError } from '@/lib/client-error-reporting'
import { toastError } from '@/lib/toast-error'

export function createMutationErrorNotifier({ area, title }: { area: string; title: string }) {
  return (error: unknown) => {
    const clientError = toClientError(error)

    if (!clientErrorMetadata(error)) {
      reportClientError({
        area,
        category: clientError.category,
        cause: clientError.cause,
        message: clientError.message,
        operation: 'mutation',
      })
    }

    if (clientError.category === 'unknown') return

    toastError(title, { description: clientErrorDescription(clientError) }, clientError)
  }
}
