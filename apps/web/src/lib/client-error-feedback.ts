import { isCancelledError } from '@tanstack/react-query'
import { agentErrorReport } from './agent-error-report'
import { copyTextToClipboard } from './clipboard'
import { reportClientError } from './client-error-reporting'
import { toastError } from '@/lib/toast-error'
import {
  clientErrorDescription,
  isAbortError,
  type ClientError,
  type ErrorCategory,
} from '@/lib/client-error-taxonomy'
import { clientErrorMetadata } from '@/lib/client-error-context'

/** Hands the failure to an agent: the catalog's answer plus how to find the log. */
function copyAgentReport(error: ClientError) {
  void copyTextToClipboard(agentErrorReport(error), 'error report for an agent')
}

export function reportError(error: ClientError): void {
  if (isCancelledError(error.cause) || isAbortError(error.cause)) return

  if (!clientErrorMetadata(error.cause)) {
    reportClientError({
      area: 'client-error-taxonomy',
      category: error.category,
      cause: error.cause,
      context: error.context,
      message: error.message,
      operation: error.operation ?? 'report',
    })
  }

  if (!shouldToastCategory(error.category)) return

  toastError(
    titleByCategory[error.category],
    {
      cancel: { label: 'Copy', onClick: () => copyAgentReport(error) },
      description: clientErrorDescription(error),
    },
    error,
  )
}

const toastableCategories: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  'not_found',
  'permission_denied',
  'too_large',
  'invalid_path',
  'io_error',
  'lossy_write',
])

function shouldToastCategory(category: ErrorCategory): boolean {
  return toastableCategories.has(category)
}

const titleByCategory: Record<ErrorCategory, string> = {
  not_found: 'File not found',
  permission_denied: 'Access denied',
  not_a_file: 'Not a file',
  not_a_directory: 'Not a folder',
  too_large: 'File too large',
  binary_file: 'Binary file',
  lossy_write: 'Save refused',
  invalid_path: 'Invalid path',
  io_error: 'Filesystem error',
  connectivity: 'Connection failed',
  unknown: 'Unexpected error',
}
