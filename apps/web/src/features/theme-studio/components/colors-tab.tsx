import {
  paletteSupportsMode,
  type ColorMode,
  type Palette,
  type PaletteColors,
  type PaletteId,
} from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { VirtualList } from '@workspace/ui/patterns/virtual-list'
import {
  deriveFromAccent,
  deriveFromBackground,
} from '@workspace/client-core/themes/palette-editing'
import { useState } from 'react'

import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { usePaletteActions } from '@/lib/theme-library/hooks/use-palette-actions'
import { ColorField } from '@/features/theme-studio/components/color-field'
import { PaletteContrast } from '@/features/theme-studio/components/palette-contrast'
import { PaletteImportDialog } from '@/features/theme-studio/components/palette-import-dialog'
import { cardSwatches } from '@/features/theme-studio/utils/card'
import { useStudioList } from '@/features/theme-studio/hooks/use-studio-list'

/**
 * App and terminal colors for the half on screen: the palettes on the left, the half's own
 * background and accent on the right. An edit makes a copy named after the theme.
 */
export function ColorsTab({
  colors,
  mode,
  palette,
  onChoose,
  onColors,
}: {
  colors: PaletteColors | null
  mode: ColorMode
  palette: Palette | undefined
  onChoose: (id: PaletteId) => void
  onColors: (colors: PaletteColors) => void
}) {
  const { catalog } = usePalette()
  const { create } = usePaletteActions()
  const [importing, setImporting] = useState(false)
  const options = catalog.filter((entry) => paletteSupportsMode(entry, mode))
  const { containerRef, virtualRef, list } = useStudioList({
    items: options.map((entry) => ({ id: entry.id, label: entry.name })),
    activeId: palette && options.some((entry) => entry.id === palette.id) ? palette.id : null,
    onActiveChange: (id) => onChoose(id as PaletteId),
  })

  return (
    <div className='flex h-full min-h-0 gap-(--density-section-padding) px-(--bar-padding-x) py-(--density-section-gap)'>
      <VirtualList
        {...list.containerProps}
        activeIndex={list.activeIndex}
        aria-label='Palettes'
        className='focus-ring-inset w-64 shrink-0 outline-none'
        getKey={(entry) => entry.id}
        handleRef={virtualRef}
        items={options}
        renderRow={(entry) => (
          <ListRow
            {...list.rowProps(entry.id)}
            role='option'
            selected={entry.id === palette?.id}
            title={entry.name}
          >
            <span className='min-w-0 flex-1 truncate'>{entry.name}</span>
            <span aria-hidden='true' className='flex shrink-0 gap-0.5'>
              {cardSwatches(entry, mode).map((color, index) => (
                <span
                  className='size-2.5 rounded-md'
                  key={index}
                  style={{ backgroundColor: color }}
                />
              ))}
            </span>
          </ListRow>
        )}
        scrollRef={containerRef}
      />
      {colors ? (
        <div className='flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain'>
          <ColorField
            id='studio-background'
            label='Background'
            value={colors.app.background}
            onChange={(color) => onColors(deriveFromBackground(colors, color))}
          />
          <ColorField
            id='studio-accent'
            label='Accent'
            value={colors.app.primary}
            onChange={(color) => onColors(deriveFromAccent(colors, color))}
          />
          <PaletteContrast colors={colors} />
        </div>
      ) : null}
      <div className='shrink-0'>
        <Button size='sm' variant='ghost' onClick={() => setImporting(true)}>
          Import palette…
        </Button>
      </div>
      <PaletteImportDialog
        open={importing}
        pending={create.isPending}
        taken={catalog.map((entry) => entry.id)}
        onCancel={() => setImporting(false)}
        onImport={(imported) =>
          create.mutate(imported, {
            onSuccess: () => {
              setImporting(false)
              onChoose(imported.id)
            },
          })
        }
      />
    </div>
  )
}
