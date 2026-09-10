import { descriptorFor, type SettingId } from '@workspace/contracts'

// Registry titles describe the choice, which can invert the stored value for hidden models.
export function settingRowTitle(id: SettingId): string {
  return descriptorFor(id).title ?? humanizeSettingId(id)
}

export function settingOptionTitle(id: SettingId, value: string): string {
  if (id !== 'workbench.colorTheme' && id !== 'workbench.palette') return value

  return value.charAt(0).toUpperCase() + value.slice(1)
}

// Keep qualifiers after the namespace: Wallpaper enabled distinguishes generic enabled leaves.
export function humanizeSettingId(id: string): string {
  const segments = id.split('.')
  const meaningful = segments.length > 1 ? segments.slice(1) : segments
  const spaced = meaningful
    .map((segment) => segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase())
    .join(' ')

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
