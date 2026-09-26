import { DiagnosticGroup } from '@/features/settings/components/diagnostic-group'
import type { SettingsDiagnostic } from '@workspace/contracts'

/**
 * The kinds where the user's value did not survive.
 *
 * `migrated` is not one of them: the value is applied, under its new id. Telling
 * someone their setting "was not applied" when it was sends them to go fix a
 * file that is already doing what they wanted — which is how a rename we handled
 * ends up reading like a rename we broke.
 */
const CARRIED_OVER: ReadonlySet<SettingsDiagnostic['kind']> = new Set(['migrated'])

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

  const carried = diagnostics.filter((diagnostic) => CARRIED_OVER.has(diagnostic.kind))
  const dropped = diagnostics.filter((diagnostic) => !CARRIED_OVER.has(diagnostic.kind))

  return (
    <div className='mb-(--density-section-padding) flex flex-col gap-(--density-control-gap)'>
      {dropped.length > 0 ? (
        <DiagnosticGroup
          diagnostics={dropped}
          summary={`${dropped.length} ${dropped.length === 1 ? 'entry' : 'entries'} in your settings files ${dropped.length === 1 ? 'was' : 'were'} not applied`}
          tone='warning'
        />
      ) : null}
      {carried.length > 0 ? (
        <DiagnosticGroup
          diagnostics={carried}
          summary={
            carried.length === 1
              ? '1 setting moved since it was written, and your value was carried over'
              : `${carried.length} settings moved since they were written, and your values were carried over`
          }
          tone='info'
        />
      ) : null}
    </div>
  )
}
