export function diagnosticRuleClass(severity: number | undefined) {
  if (severity === 1) return 'border-l-destructive'
  if (severity === 2) return 'border-l-warning'
  if (severity === 3) return 'border-l-info'

  return 'border-l-transparent'
}
