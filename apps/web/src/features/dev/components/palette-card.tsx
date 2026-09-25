import type { CSSProperties } from 'react'
import { Spinner } from '@workspace/ui/components/spinner'
import type { PalettePreview } from '@/features/dev/utils/palette-previews'

export function PaletteCard({ preview }: { readonly preview: PalettePreview }) {
  return (
    <div
      className='bg-background text-foreground flex flex-col gap-3 rounded-md p-(--density-section-padding)'
      style={preview.variables as CSSProperties}
    >
      <div className='flex items-baseline justify-between gap-2'>
        <span className='text-xs font-medium'>{preview.name}</span>
        <span className='text-muted-foreground text-2xs'>{preview.mode}</span>
      </div>
      <div className='flex items-center gap-4'>
        <Spinner size='xs' />
        <Spinner size='sm' />
        <Spinner size='md' />
        <Spinner size='lg' />
      </div>
      <div className='text-muted-foreground flex items-center gap-2 text-xs'>
        <Spinner size='xs' aria-hidden='true' />
        Thinking
      </div>
    </div>
  )
}
