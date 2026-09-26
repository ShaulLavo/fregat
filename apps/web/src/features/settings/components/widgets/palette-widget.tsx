import type { ColorMode, PaletteId } from '@workspace/contracts'
import { cn } from '@workspace/ui/lib/utils'

import { PaletteList } from '@/lib/appearance/components/palette-list'

/** With no theme the palette serves both modes, so every palette is listed. */
export function PaletteWidget({
  disabled,
  mode,
  themed,
  value,
  onChange,
}: {
  disabled: boolean
  mode: ColorMode
  themed: boolean
  value: string
  onChange: (next: PaletteId) => void
}) {
  return (
    <div className={cn('h-56 w-full min-w-0', disabled && 'opacity-50')} inert={disabled}>
      <PaletteList
        anyMode={!themed}
        className='h-full'
        mode={mode}
        value={value}
        onChange={onChange}
      />
    </div>
  )
}
