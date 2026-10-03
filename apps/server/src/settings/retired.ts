import type { SettingId, SettingsDiagnostic } from '@workspace/contracts'
import { presentSetting } from '@workspace/contracts/settings/documentation'

const RETIRED: Readonly<
  Record<string, { readonly title: string; readonly replacedBy?: SettingId }>
> = {
  'window.frost': { title: 'Window frost', replacedBy: 'window.material' },
}

export function removedSettingsDiagnostics(keys: readonly string[]): SettingsDiagnostic[] {
  return keys.map((id) => {
    const retired = Object.hasOwn(RETIRED, id) ? RETIRED[id] : undefined
    const title = retired?.title ?? id
    const detail = retired?.replacedBy
      ? `${title} was replaced by ${presentSetting(retired.replacedBy).title}.`
      : `Removed setting from an older version: ${title}.`

    return { kind: 'removed-key', id, layer: 'user', detail }
  })
}
