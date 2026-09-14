import { toast } from 'sonner'

import { clientErrorMetadata } from '@/lib/client-error-context'
import { toClientError } from '@/lib/client-error-taxonomy'
import { reportClientError } from '@/lib/client-error-reporting'

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

    toast.error(title, { description: clientError.message })
  }
}
