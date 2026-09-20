import { TerminalWindowIcon } from '@phosphor-icons/react'
import { CommandGroup } from '@workspace/ui/components/command'

import type { ViewPaletteItem } from '@/features/command-palette/utils/types'
import { PlatformCommandItem } from '@/features/command-palette/components/platform-command-item'

export function ViewGroups({ items }: { readonly items: readonly ViewPaletteItem[] }) {
  return (
    <CommandGroup heading='Views'>
      {items.map((item) => (
        <PlatformCommandItem key={item.value} item={item} icon={TerminalWindowIcon} />
      ))}
    </CommandGroup>
  )
}
