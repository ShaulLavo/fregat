import { SwatchesIcon } from '@phosphor-icons/react'
import type { ThemeBundle } from '@workspace/contracts'
import { CommandGroup, CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import { RowLabel } from '@/features/command-palette/components/row-label'
import { themeBundleItemValue } from '@/features/command-palette/utils/theme-bundles'
import { useBundles } from '@/lib/appearance/hooks/use-bundles'
import { useCommand } from '@/keymap/hooks/use-command'

export function ThemeBundleGroups() {
  const { bundleId, catalog, select } = useBundles()
  const { closePalette } = useCommand()
  const bundled = catalog.filter((bundle) => bundle.source === 'bundled')
  const yours = catalog.filter((bundle) => bundle.source !== 'bundled')

  function item(bundle: ThemeBundle) {
    return (
      <CommandItem
        key={bundle.id}
        keywords={[bundle.name, bundle.id]}
        title={bundle.id}
        value={themeBundleItemValue(bundle.id)}
        onSelect={() => {
          select(bundle, 'workspace.selectThemeBundle')
          closePalette(true)
        }}
      >
        <SwatchesIcon className='text-muted-foreground' />
        <RowLabel label={bundle.name} />
        {bundle.id === bundleId && <CommandShortcut>active</CommandShortcut>}
      </CommandItem>
    )
  }

  return (
    <>
      <CommandGroup heading='Themes'>{bundled.map(item)}</CommandGroup>
      {yours.length > 0 ? (
        <CommandGroup heading='Your themes'>{yours.map(item)}</CommandGroup>
      ) : null}
    </>
  )
}
