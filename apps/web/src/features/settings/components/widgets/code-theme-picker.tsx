import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@workspace/ui/components/command'
import { useState } from 'react'

import { CodeThemePreview } from '@/lib/code-theme/components/preview'
import { editorThemeOptions, type EditorColorModeType } from '@/lib/code-theme/utils/catalog'

export function CodeThemePicker({
  colorMode,
  onSelect,
  value,
}: {
  readonly colorMode: EditorColorModeType
  readonly onSelect: (themeId: string) => void
  readonly value: string
}) {
  const [highlightedId, setHighlightedId] = useState(value)
  const themes = editorThemeOptions(colorMode)
  const highlighted = themes.find((theme) => theme.id === highlightedId)

  return (
    <Command
      label={`Search ${colorMode} code themes`}
      loop
      onValueChange={setHighlightedId}
      value={highlightedId}
    >
      <CommandInput
        aria-label={`Search ${colorMode} code themes`}
        placeholder={`Search ${colorMode} code themes…`}
      />
      <div className='grid min-h-0 sm:grid-cols-[14rem_minmax(0,1fr)]'>
        <CommandList
          aria-label={`${colorMode === 'dark' ? 'Dark' : 'Light'} code themes`}
          className='max-h-44 py-1 sm:max-h-80'
        >
          <CommandEmpty>No themes found.</CommandEmpty>
          {themes.map((theme) => (
            <CommandItem
              key={theme.id}
              className='min-h-9 gap-2'
              keywords={[theme.label, theme.id, theme.subtitle]}
              onSelect={() => onSelect(theme.id)}
              title={theme.id}
              value={theme.id}
            >
              <span className='flex min-w-0 flex-col gap-0.5'>
                <span className='truncate'>{theme.label}</span>
                {theme.subtitle ? (
                  <span className='text-muted-foreground text-3xs'>{theme.subtitle}</span>
                ) : null}
              </span>
              {theme.id === value ? (
                <CommandShortcut className='text-3xs tracking-normal'>Current</CommandShortcut>
              ) : null}
            </CommandItem>
          ))}
        </CommandList>
        <div className='border-border min-w-0 border-t sm:border-t-0 sm:border-l'>
          {highlighted ? (
            <>
              <div
                className='flex h-(--bar-height) items-center justify-between gap-(--density-control-gap) px-(--bar-padding-x) text-xs'
                title={highlighted.id}
              >
                <span className='truncate font-medium'>{highlighted.label}</span>
                <span className='text-muted-foreground text-3xs'>Preview</span>
              </div>
              <CodeThemePreview themeId={highlighted.id} />
            </>
          ) : (
            <p className='text-muted-foreground px-4 py-8 text-xs'>
              Choose a theme to preview its code colors.
            </p>
          )}
        </div>
      </div>
      <p className='text-muted-foreground border-border text-2xs border-t px-3 py-2'>
        Arrow keys to preview · Enter to use theme · Esc to cancel
      </p>
    </Command>
  )
}
