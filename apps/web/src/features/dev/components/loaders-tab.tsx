import { useState } from 'react'
import { Switch } from '@workspace/ui/components/switch'
import { cn } from '@workspace/ui/lib/utils'
import { OtherLoaders } from '@/features/dev/components/other-loaders'
import { PaletteGrid } from '@/features/dev/components/palette-grid'
import { Section } from '@/features/dev/components/section'
import { SpinnerContexts } from '@/features/dev/components/spinner-contexts'
import { SpinnerSizes } from '@/features/dev/components/spinner-sizes'

export function LoadersTab() {
  const [paused, setPaused] = useState(false)

  return (
    <div
      className={cn(
        'mx-auto flex max-w-6xl flex-col gap-8 p-(--density-section-padding)',
        paused && '[&_*]:[animation-play-state:paused]',
      )}
    >
      <label className='flex items-center gap-2 self-end text-xs'>
        <Switch checked={paused} onCheckedChange={setPaused} />
        Pause animations
      </label>
      <Section
        title='Spinner'
        detail='One mark, four sizes. Colours come from the current palette.'
      >
        <SpinnerSizes />
      </Section>
      <Section title='In place' detail='Where each size lands in the app.'>
        <SpinnerContexts />
      </Section>
      <Section
        title='Every bundled palette'
        detail='Each card scopes one palette, so the spinner re-derives its colours from that primary.'
      >
        <PaletteGrid />
      </Section>
      <Section
        title='Skeleton and shimmer'
        detail='LoadingState for a region with no content yet; Shimmer for text already on screen.'
      >
        <OtherLoaders />
      </Section>
    </div>
  )
}
