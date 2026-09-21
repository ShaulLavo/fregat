import { createDiagnosticSanitizer, sanitizeRecord } from '@workspace/observability/sanitize'
import { isObject } from '@workspace/utils/objects'
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
  formatString: (value) => value,
  errorFields: (error) => ({
    code: errorStringField(error, 'code'),
    fix: errorStringField(error, 'fix'),
    internal: errorInternal(error),
    status: errorNumberField(error, 'statusCode') ?? errorNumberField(error, 'status'),
    why: errorStringField(error, 'why'),
  }),
})

/**
 * The runtime facts a throw site attached. `internal` is a getter, so the
 * sanitizer's own field walk never reaches it — and `errorFields` output is
 * spread in unsanitized, so it has to be redacted here.
 */
function errorInternal(error: Error) {
  const internal = (error as { internal?: unknown }).internal
  return isObject(internal) ? sanitizeRecord(internal) : undefined
}

export function reportClientError(report: ClientErrorReport): void {
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
