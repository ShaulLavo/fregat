import { TerminalWindowIcon } from '@phosphor-icons/react'
import { CommandGroup } from '@workspace/ui/components/command'

import { viewPaletteItems } from '@/features/command-palette/utils/data'
import { PlatformCommandItem } from '@/features/command-palette/components/platform-command-item'

export function ViewGroups() {
  return (
    <CommandGroup heading='Views'>
      {viewPaletteItems.map((item) => (
        <PlatformCommandItem key={item.value} item={item} icon={TerminalWindowIcon} />
      ))}
    </CommandGroup>
  )
}
