import { toast } from 'sonner'

import { clientErrorMetadata } from '@/lib/client-error-context'
import { reportClientError } from '@/lib/client-error-reporting'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'

export function notifySaveError({
  discard,
  error,
  mutationId,
  retry,
}: {
  readonly discard: () => void
  readonly error: unknown
  readonly mutationId: string
  readonly retry: () => void
}) {
  const clientError = toClientError(error)

  // The transport operation already emitted the canonical wide failure event.
  // Only errors raised outside that observed boundary need a second report.
  if (!clientErrorMetadata(error)) {
    reportClientError({
      area: 'settings',
      category: clientError.category,
      cause: clientError.cause,
      message: clientError.message,
      operation: 'mutation',
    })
  }

  if (clientError.category === 'unknown') return

  toast.error('Could not save settings', {
    action: { label: 'Retry', onClick: retry },
    cancel: { label: 'Discard', onClick: discard },
    description: clientErrorDescription(clientError),
    id: settingsSaveToastId(mutationId),
  })
}

export function dismissSaveError(mutationId: string) {
  toast.dismiss(settingsSaveToastId(mutationId))
}

function settingsSaveToastId(mutationId: string) {
  return `settings-save:${mutationId}`
}
