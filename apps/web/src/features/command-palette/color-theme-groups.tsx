import { PaletteIcon } from '@phosphor-icons/react'
import { CommandGroup, CommandItem, CommandShortcut } from '@workspace/ui/components/command'
import { useEffect } from 'react'

import { useCommandPaletteActions } from '@/features/command-palette/hooks/use-command-palette-actions'
import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { preloadVscodeThemeRegistrations } from '@/features/editor/state/color-theme-store'
import { editorThemeOptions } from '@/lib/code-theme/utils/catalog'
import { colorThemeItemValue } from '@/features/command-palette/command-palette-utils'
import { RowLabel } from '@/features/command-palette/row-label'

export function ColorThemeGroups() {
  const { selectColorTheme } = useCommandPaletteActions()
  const { committedThemeId, colorMode } = useEditorColorTheme()

  useEffect(() => {
    void preloadVscodeThemeRegistrations()
  }, [])

  return (
    <CommandGroup heading={`Code theme for ${colorMode} mode`}>
      {editorThemeOptions(colorMode).map((theme) => (
        <CommandItem
          key={theme.id}
          keywords={[theme.label, theme.id, theme.type, theme.source]}
          title={`${theme.id} (${theme.source})`}
          value={colorThemeItemValue(theme.id)}
          onSelect={() => selectColorTheme(theme.id)}
        >
          <PaletteIcon className='text-muted-foreground' />
          <RowLabel label={theme.label} description={theme.subtitle} />
          {theme.id === committedThemeId && <CommandShortcut>active</CommandShortcut>}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
