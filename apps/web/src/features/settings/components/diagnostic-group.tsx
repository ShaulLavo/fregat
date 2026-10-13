import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import type { SettingsDiagnostic } from '@workspace/contracts'
import { DiagnosticEntry } from '@/features/settings/components/diagnostic-entry'

export function DiagnosticGroup({
  diagnostics,
  summary,
  tone,
}: {
  readonly diagnostics: readonly SettingsDiagnostic[]
  readonly summary: string
  readonly tone: 'warning' | 'info'
}) {
  return (
    <Alert role='status' variant={tone}>
      <AlertTitle>{summary}</AlertTitle>
      <AlertDescription>
        <ul className='flex flex-col gap-0.5'>
          {diagnostics.map((diagnostic) => (
            <DiagnosticEntry diagnostic={diagnostic} key={`${diagnostic.layer}:${diagnostic.id}`} />
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
