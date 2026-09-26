import { Slider } from '@workspace/ui/components/slider'

import {
  MATERIAL_LIMITS,
  MATERIAL_UNITS,
  type MaterialField,
} from '@/lib/appearance/utils/material'

/**
 * One surface material value on a track, with its reading. `onChange` follows the thumb;
 * `onCommit` fires once when a drag or key press lands.
 */
export function MaterialSlider({
  disabled,
  field,
  label,
  value,
  onChange,
  onCommit,
}: {
  disabled?: boolean
  field: MaterialField
  label: string
  value: number
  onChange: (value: number) => void
  onCommit?: (value: number) => void
}) {
  return (
    <>
      <Slider
        aria-label={label}
        disabled={disabled}
        max={MATERIAL_LIMITS[field]}
        min={0}
        value={value}
        onValueChange={(next: number) => onChange(next)}
        onValueCommitted={(next: number) => onCommit?.(next)}
      />
      <span className='text-muted-foreground min-w-12 shrink-0 text-right font-mono text-xs tabular-nums'>
        {value}
        {MATERIAL_UNITS[field]}
      </span>
    </>
  )
}
