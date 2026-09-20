import type { Theme } from '@/features/settings/providers/theme-context'
import { CommandIcon } from '@phosphor-icons/react'
import { CommandGroup } from '@workspace/ui/components/command'

import type { ColorModePaletteItem } from '@/features/command-palette/utils/types'
import { PlatformCommandItem } from '@/features/command-palette/components/platform-command-item'

type ColorModeGroupsProps = {
  readonly currentTheme: Theme
  readonly items: readonly ColorModePaletteItem[]
}

export function ColorModeGroups({ currentTheme, items }: ColorModeGroupsProps) {
  return (
    <CommandGroup heading='Light / dark mode'>
      {items.map((item) => (
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
