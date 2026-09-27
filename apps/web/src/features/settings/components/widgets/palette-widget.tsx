import type { ColorMode, PaletteId } from '@workspace/contracts'
import { cn } from '@workspace/ui/lib/utils'

import { PaletteList } from '@/lib/appearance/components/palette-list'

/** With no theme the palette serves both modes, so every palette is listed. */
export function PaletteWidget({
  disabled,
  labelledBy,
  mode,
  themed,
  value,
  onChange,
}: {
  disabled: boolean
  labelledBy: string
  mode: ColorMode
  themed: boolean
  value: string
  onChange: (next: PaletteId) => void
}) {
  return (
    <div className={cn('w-full min-w-0', disabled && 'opacity-50')} inert={disabled}>
      <PaletteList
        anyMode={!themed}
        labelledBy={labelledBy}
        maxRows={10}
        mode={mode}
        value={value}
        onChange={onChange}
      />
    </div>
  )
}
