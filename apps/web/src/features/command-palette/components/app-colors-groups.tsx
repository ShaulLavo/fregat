import { PaletteIcon } from '@phosphor-icons/react'
import { CommandGroup, CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import { RowLabel } from '@/features/command-palette/row-label'
import { appColorItems } from '@/features/command-palette/utils/app-colors'
import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { useCommand } from '@/keymap/hooks/use-command'

export function AppColorsGroups() {
  const { catalog, paletteId, selectPalette } = usePalette()
  const { closePalette } = useCommand()

  return (
    <CommandGroup heading='App colors'>
      {appColorItems(catalog).map((item) => (
        <CommandItem
          key={item.value}
          keywords={[item.label, item.id]}
          title={item.id}
          value={item.value}
          onSelect={() => {
            selectPalette(item.id, 'workspace.selectAppColors')
            closePalette(true)
          }}
        >
          <PaletteIcon className='text-muted-foreground' />
          <RowLabel label={item.label} />
          {item.id === paletteId && <CommandShortcut>active</CommandShortcut>}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
