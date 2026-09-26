import type { ThemeVariant, ThemeVariantPatch } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Slider } from '@workspace/ui/components/slider'

import {
  MATERIAL_LABELS,
  MATERIAL_LIMITS,
  MATERIAL_UNITS,
  SURFACE_PRESETS,
} from '@/features/theme-studio/utils/surfaces'
import { jsonEqual } from '@workspace/contracts'

const FIELDS = ['opacity', 'contentOpacity', 'blur', 'saturation'] as const

/** How much the panes let the wallpaper through, previewed as the slider moves. */
export function SurfacesTab({
  material,
  onEdit,
}: {
  material: ThemeVariant['material']
  onEdit: (patch: ThemeVariantPatch) => void
}) {
  return (
    <div className='flex h-full gap-(--density-section-padding) px-(--bar-padding-x) py-(--density-section-gap)'>
      <div className='grid min-w-0 flex-1 grid-cols-[6rem_minmax(0,1fr)_4rem] items-center gap-x-3 gap-y-1'>
        {FIELDS.map((field) => (
          <label className='contents' key={field}>
            <span className='text-xs'>{MATERIAL_LABELS[field]}</span>
            <Slider
              aria-label={MATERIAL_LABELS[field]}
              max={MATERIAL_LIMITS[field]}
              min={0}
              value={material[field]}
              onValueChange={(value: number) => onEdit({ material: { [field]: value } })}
            />
            <span className='text-muted-foreground text-right font-mono text-xs tabular-nums'>
              {material[field]}
              {MATERIAL_UNITS[field]}
            </span>
          </label>
        ))}
      </div>
      <div aria-label='Presets' className='flex shrink-0 flex-col gap-1' role='group'>
        {SURFACE_PRESETS.map((preset) => (
          <Button
            aria-pressed={jsonEqual(preset.material, material)}
            className='aria-pressed:bg-accent justify-start'
            key={preset.label}
            size='sm'
            variant='ghost'
            onClick={() => onEdit({ material: preset.material })}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
