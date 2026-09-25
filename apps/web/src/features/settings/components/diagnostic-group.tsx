import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import type { SettingsDiagnostic } from '@workspace/contracts'
import { settingsDiagnosticLabel } from '@workspace/client-core/settings/humanize'

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
            <li key={`${diagnostic.layer}:${diagnostic.id}`}>
              <code>{diagnostic.id}</code> in {diagnostic.layer} settings —{' '}
              {settingsDiagnosticLabel(diagnostic.kind)}
              {diagnostic.detail ? `: ${diagnostic.detail}` : ''}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
