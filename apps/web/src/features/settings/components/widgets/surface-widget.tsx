import { useState } from 'react'

import { MaterialSlider } from '@/lib/appearance/components/material-slider'
import type { MaterialField } from '@/lib/appearance/utils/material'

/** The thumb moves freely; the setting is written once, when the drag or key press lands. */
export function SurfaceWidget({
  disabled,
  field,
  label,
  value,
  onCommit,
}: {
  disabled: boolean
  field: MaterialField
  label: string
  value: number
  onCommit: (next: number) => void
}) {
  const [dragged, setDragged] = useState<number | null>(null)

  return (
    <div className='flex w-full min-w-0 items-center gap-(--density-control-gap) @3xl/settings:w-72'>
      <MaterialSlider
        disabled={disabled}
        field={field}
        label={label}
        value={dragged ?? value}
        onChange={setDragged}
        onCommit={(next) => {
          setDragged(null)
          if (next !== value) onCommit(next)
        }}
      />
    </div>
  )
}
