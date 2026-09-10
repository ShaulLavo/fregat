import { PaletteIcon } from '@phosphor-icons/react'
import { CommandGroup, CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import { RowLabel } from '@/features/command-palette/row-label'
import { appColorItems } from '@/features/command-palette/utils/app-colors'
import { useTheme } from '@/features/settings/hooks/use-theme'
import { useCommand } from '@/keymap/hooks/use-command'

export function AppColorsGroups() {
  const { appColors, setAppColors } = useTheme()
  const { closePalette } = useCommand()

  return (
    <CommandGroup heading='App colors'>
      {appColorItems.map((item) => (
        <CommandItem
          key={item.value}
          keywords={[item.label, item.colors]}
          value={item.value}
          onSelect={() => {
            setAppColors(item.colors, 'workspace.selectAppColors')
            closePalette(true)
          }}
        >
          <PaletteIcon className='text-muted-foreground' />
          <RowLabel label={item.label} />
          {item.colors === appColors && <CommandShortcut>active</CommandShortcut>}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
