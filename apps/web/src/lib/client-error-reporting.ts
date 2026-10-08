import { isCancelledError } from '@tanstack/react-query'
import { createDiagnosticSanitizer } from '@workspace/observability/sanitize'
import { errorNumberField, errorStringField } from '@workspace/contracts'

import { log } from './client-logging'

type ClientErrorReport = {
  area: string
  operation: string
  message: string
  category?: string
  cause?: unknown
  context?: Record<string, unknown>
}

const sanitizeDiagnosticValue = createDiagnosticSanitizer({
  // No limit here: `safeClientEvent` keeps the head 2000 characters of every string.
  formatString: (value) => value,
  errorFields: (error) => ({
    code: errorStringField(error, 'code'),
    fix: errorStringField(error, 'fix'),
    status: errorNumberField(error, 'statusCode') ?? errorNumberField(error, 'status'),
    why: errorStringField(error, 'why'),
  }),
})

export function reportClientError(report: ClientErrorReport): void {
  if (isCancelledError(report.cause)) return

  const safeReport = safeClientErrorReport(report)

  const level = report.category === 'connectivity' ? 'warn' : 'error'
  log[level]({
    action: 'client.error',
    area: report.area,
    category: report.category,
    cause: safeReport.cause,
    context: safeReport.context,
    message: report.message,
    operation: report.operation,
  })
}

function safeClientErrorReport(report: ClientErrorReport) {
  return {
    category: report.category,
    cause: sanitizeDiagnosticValue(report.cause),
    context: sanitizeDiagnosticValue(report.context),
    message: report.message,
  }
}
