import type { Theme } from '@/features/settings/providers/theme-context'
import { CommandIcon } from '@phosphor-icons/react'
import { CommandGroup, CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import { useCommandPaletteActions } from '@/features/command-palette/hooks/use-command-palette-actions'
import { colorModePaletteItems } from '@/features/command-palette/command-palette-data'
import { RowLabel } from '@/features/command-palette/row-label'

type ColorModeGroupsProps = {
  readonly currentTheme: Theme
}

export function ColorModeGroups({ currentTheme }: ColorModeGroupsProps) {
  const { disabledReasonForCommand, selectPlatformCommand } = useCommandPaletteActions()

  return (
    <CommandGroup heading='Light / dark mode'>
      {colorModePaletteItems.map((item) => {
        const disabledReason = disabledReasonForCommand(item.command)

        return (
          <CommandItem
            disabled={Boolean(disabledReason)}
            key={item.value}
            keywords={[item.title, item.description, item.command]}
            value={item.value}
            onSelect={() => void selectPlatformCommand(item.command)}
          >
            <CommandIcon className='text-muted-foreground' />
            <RowLabel label={item.title} description={disabledReason ?? item.description} />
            {item.mode === currentTheme && <CommandShortcut>active</CommandShortcut>}
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}
