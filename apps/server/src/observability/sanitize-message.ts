import { sensitiveDiagnosticFields } from '@workspace/observability/sanitize'

export const redactedDiagnosticValue = '[redacted]'

// The request logger and FsError's cause also redact `path`: Node errors carry absolute ones.
export const sensitiveErrorFields: ReadonlySet<string> = new Set([
  ...sensitiveDiagnosticFields,
  'path',
])

export function sanitizeErrorMessage(message: string) {
  return message.replaceAll(/'[^']*'/g, `'${redactedDiagnosticValue}'`)
}
