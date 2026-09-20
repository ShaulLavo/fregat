import type { Theme } from '@/features/settings/providers/theme-context'
import { CommandIcon } from '@phosphor-icons/react'
import { CommandGroup } from '@workspace/ui/components/command'

import { colorModePaletteItems } from '@/features/command-palette/command-palette-data'
import { PlatformCommandItem } from '@/features/command-palette/components/platform-command-item'

type ColorModeGroupsProps = {
  readonly currentTheme: Theme
}

export function ColorModeGroups({ currentTheme }: ColorModeGroupsProps) {
  return (
    <CommandGroup heading='Light / dark mode'>
      {colorModePaletteItems.map((item) => (
        <PlatformCommandItem
          key={item.value}
          item={item}
          icon={CommandIcon}
          active={item.mode === currentTheme}
        />
      ))}
    </CommandGroup>
  )
}
