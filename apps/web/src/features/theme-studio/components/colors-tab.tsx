import type { ColorMode, Palette, PaletteColors, PaletteId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  deriveFromAccent,
  deriveFromBackground,
} from '@workspace/client-core/themes/palette-editing'
import { useState } from 'react'

import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { usePaletteActions } from '@/features/theme-studio/hooks/use-palette-actions'
import { ColorField } from '@/features/theme-studio/components/color-field'
import { PaletteContrast } from '@/features/theme-studio/components/palette-contrast'
import { PaletteImportDialog } from '@/features/theme-studio/components/palette-import-dialog'
import { PaletteList } from '@/lib/appearance/components/palette-list'

/**
 * App and terminal colors for the half on screen: the palette list on the left, the half's own
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

  return (
    <div className='flex h-full min-h-0 gap-(--density-section-padding) px-(--bar-padding-x) py-(--density-section-gap)'>
      <PaletteList
        className='w-64 shrink-0'
        mode={mode}
        value={palette?.id ?? null}
        onChange={onChoose}
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
