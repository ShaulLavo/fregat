import { isRecord } from '@workspace/utils/objects'
import { settingsErrors } from './structured-errors'

/**
 * The policy layer, from `PLATFORM_SETTINGS_POLICY` holding JSON.
 *
 * Not an enterprise MDM feature — there are no principals here to manage. It
 * earns its place as the pinning lever: a test or a CI run can hold a setting
 * fixed regardless of what is on disk, and the page gets a real "managed, cannot
 * be changed" state to render rather than a hypothetical one.
 *
 * Parsed strictly, unlike the settings files. A malformed settings file is a
 * user mid-edit and must degrade gracefully; a malformed policy is an operator
 * mistake, and silently ignoring it would mean the pin is not applied and
 * nothing says so.
 */
export function settingsPolicyFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> | undefined {
  const raw = env.PLATFORM_SETTINGS_POLICY?.trim()
  if (!raw) return undefined

  const parsed = parseJson(raw)
  if (!isRecord(parsed)) {
    throw settingsErrors.FILE_MALFORMED({
      detail: 'PLATFORM_SETTINGS_POLICY must be a JSON object of setting id to value',
    })
  }

  return parsed
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw settingsErrors.FILE_MALFORMED({
      detail: `PLATFORM_SETTINGS_POLICY: ${error instanceof Error ? error.message : 'not valid JSON'}`,
    })
  }
}
