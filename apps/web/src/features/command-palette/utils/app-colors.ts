import { SETTINGS_REGISTRY } from '@workspace/contracts'
import { settingOptionTitle } from '@workspace/client-core/settings/humanize'

export const appColorItems = SETTINGS_REGISTRY['workbench.palette'].schema.options.map(
  (colors) => ({
    colors,
    label: settingOptionTitle('workbench.palette', colors),
    value: `app-colors:${colors}`,
  }),
)

export function appColorsFromItemValue(value: string) {
  return appColorItems.find((item) => item.value === value)?.colors ?? null
}
