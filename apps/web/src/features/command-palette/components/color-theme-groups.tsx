import { PaletteIcon } from '@phosphor-icons/react'
import { CommandGroup, CommandItem, CommandShortcut } from '@workspace/ui/components/command'
import { useEffect } from 'react'

import { useActions } from '@/features/command-palette/hooks/use-actions'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { preloadVscodeThemeRegistrations } from '@/features/editor/state/color-theme-store'
import { editorThemeOptions } from '@/lib/code-theme/utils/catalog'
import { colorThemeItemValue } from '@/features/command-palette/utils/query'
import { RowLabel } from '@/features/command-palette/components/row-label'

export function ColorThemeGroups() {
  const { selectColorTheme } = useActions()
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
