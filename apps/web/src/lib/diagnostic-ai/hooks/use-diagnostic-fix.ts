import { useMutation } from '@tanstack/react-query'
import { use } from 'react'

import { DiagnosticFixContext } from '@/lib/diagnostic-ai/providers/context'
import { diagnosticAiMutationKeys } from '@/lib/diagnostic-ai/utils/mutation-keys'
import type { DiagnosticFixRequest } from '@/lib/diagnostic-ai/utils/prompt'
import { createMutationErrorNotifier } from '@/lib/mutations/notify-error'
import { clientErrors } from '@/lib/structured-errors'

const notifyFixError = createMutationErrorNotifier({
  area: 'chat',
  title: 'Could not open a chat for this problem',
})

/**
 * Fix with AI for one diagnostic surface; pending and failure are the mutation's own.
 * `available` is false in a tree with no chat to open.
 */
export function useDiagnosticFix() {
  const requestFix = use(DiagnosticFixContext)
  const mutation = useMutation({
    mutationKey: diagnosticAiMutationKeys.fix(),
    mutationFn: (request: DiagnosticFixRequest) => {
      if (!requestFix)
        throw clientErrors.CONTEXT_MISSING({
          message: 'Fix with AI ran outside DiagnosticFixProvider',
        })
      return requestFix(request)
    },
    onError: notifyFixError,
  })

  return { available: requestFix !== null, mutation }
}
