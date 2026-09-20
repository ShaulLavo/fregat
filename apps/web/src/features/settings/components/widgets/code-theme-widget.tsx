import { CaretDownIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { useState } from 'react'

import { CodeThemePicker } from '@/features/settings/components/widgets/code-theme-picker'
import { CodeThemePreview } from '@/lib/code-theme/components/preview'
import { editorThemeOptions } from '@/lib/code-theme/utils/catalog'

export function CodeThemeWidget({
  disabled,
  id,
  onChange,
  value,
}: {
  readonly disabled: boolean
  readonly id: string
  readonly onChange: (next: string) => void
  readonly value: string
}) {
  const [open, setOpen] = useState(false)
  const colorMode = id === 'editor.codeTheme.light' ? 'light' : 'dark'
  const themes = editorThemeOptions(colorMode)
  const selected = themes.find((theme) => theme.id === value)

  return (
    <div className='bg-muted w-full min-w-0 overflow-hidden rounded-lg'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          render={
            <Button
              className='h-(--bar-height) w-full justify-between gap-(--density-control-gap) border-0 px-(--bar-padding-x) text-xs'
              disabled={disabled}
              id={id}
              variant='ghost'
            />
          }
          title={value}
        >
          <span className='truncate font-medium'>{selected?.label ?? `Unavailable: ${value}`}</span>
          <span className='text-muted-foreground flex shrink-0 items-center gap-2 font-normal'>
            Change theme
            <CaretDownIcon className='size-(--icon-size-sm)' />
          </span>
        </PopoverTrigger>
        <PopoverContent
          align='end'
          aria-label={`Choose a code theme for ${colorMode} mode`}
          className='max-h-(--available-height) w-[46rem] max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-0'
          sideOffset={8}
        >
          <CodeThemePicker
            colorMode={colorMode}
            onSelect={(themeId) => {
              if (themeId !== value) onChange(themeId)
              setOpen(false)
            }}
            value={value}
          />
        </PopoverContent>
      </Popover>
      <CodeThemePreview themeId={value} />
    </div>
  )
}
