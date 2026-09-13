import { paletteColorsFor, type Palette } from '@workspace/contracts'
import { Badge } from '@workspace/ui/components/badge'
import { cn } from '@workspace/ui/lib/utils'
import type { ReactNode } from 'react'

import { PaletteSwatches } from '@/features/settings/components/widgets/palette-swatches'
import { editableModes } from '@/features/settings/utils/palette-editing'

/**
 * One gallery entry. Keyboard focus previews the whole app; a mouse never
 * does, because a pointer crossing the gallery would repaint the workbench
 * four times on the way to the button it wanted. Click or Enter selects. The
 * menu sits beside the radio rather than inside it so a menu click never
 * doubles as a selection.
 */
export function PaletteCard({
  disabled,
  menu,
  onPreview,
  onPreviewEnd,
  onSelect,
  palette,
  selected,
}: {
  readonly disabled: boolean
  readonly menu: ReactNode
  readonly onPreview: () => void
  readonly onPreviewEnd: () => void
  readonly onSelect: () => void
  readonly palette: Palette
  readonly selected: boolean
}) {
  const modes = editableModes(palette)

  return (
    <div
      className={cn(
        'border-border bg-card relative flex flex-col rounded-lg border',
        selected && 'ring-ring ring-1',
      )}
      data-palette-card={palette.id}
    >
      <button
        aria-checked={selected}
        className='focus-ring pressable flex min-w-0 flex-col gap-2 rounded-lg p-2 text-left disabled:opacity-50'
        disabled={disabled}
        onBlur={onPreviewEnd}
        onClick={onSelect}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) onPreview()
        }}
        role='radio'
        type='button'
      >
        <span className='flex items-center gap-2 pr-7'>
          <span className='text-foreground truncate text-xs font-medium'>{palette.name}</span>
          {palette.variants.kind === 'single' ? (
            <Badge variant='secondary'>
              {palette.variants.mode === 'dark' ? 'Dark only' : 'Light only'}
            </Badge>
          ) : null}
          {selected ? <Badge>Current</Badge> : null}
        </span>
        <span className='grid grid-cols-2 gap-1'>
          {modes.map((mode) => (
            <PaletteSwatches
              colors={paletteColorsFor(palette, mode)}
              key={mode}
              label={`${palette.name} ${mode}`}
            />
          ))}
        </span>
      </button>
      <div className='absolute top-1.5 right-1.5'>{menu}</div>
    </div>
  )
}
