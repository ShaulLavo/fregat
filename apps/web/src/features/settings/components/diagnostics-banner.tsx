import type { SettingsDiagnostic } from '@workspace/contracts'

const LABELS: Record<SettingsDiagnostic['kind'], string> = {
  'invalid-value': 'invalid value',
  'scope-not-allowed': 'not allowed in that scope',
  'unknown-key': 'unknown setting',
}

/**
 * What the settings files hold that did not become a value.
 *
 * Without this the failure is silent: a renamed key, a workspace file setting
 * something it may not set, and a value that fails its schema all just look like
 * the setting was ignored. The resolver already reports each one — the only
 * thing missing was somewhere to show them.
 */
export function DiagnosticsBanner({ diagnostics }: { diagnostics: readonly SettingsDiagnostic[] }) {
  if (diagnostics.length === 0) return null

  return (
    <div className='border-warning/30 bg-warning/10 mb-(--density-section-padding) rounded-lg border p-(--density-section-padding)'>
      <p className='text-warning text-xs font-medium'>
        {diagnostics.length} {diagnostics.length === 1 ? 'entry' : 'entries'} in your settings files{' '}
        {diagnostics.length === 1 ? 'was' : 'were'} not applied
      </p>
      <ul className='mt-1 flex flex-col gap-0.5'>
        {diagnostics.map((diagnostic) => (
          <li
            className='text-muted-foreground text-xs'
            key={`${diagnostic.layer}:${diagnostic.id}`}
          >
            <code>{diagnostic.id}</code> in {diagnostic.layer} settings — {LABELS[diagnostic.kind]}
            {diagnostic.detail ? `: ${diagnostic.detail}` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}
