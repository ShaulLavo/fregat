const redactedDiagnosticValue = '[redacted]'
export function sanitizeErrorMessage(message: string) {
  return message.replaceAll(/'[^']*'/g, `'${redactedDiagnosticValue}'`)
}
