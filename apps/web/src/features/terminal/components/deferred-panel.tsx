import { RingLoader } from '@workspace/ui/components/ring-loader'
import { cn } from '@workspace/ui/lib/utils'
import { Suspense, type ComponentProps } from 'react'

import { LoadedTerminalPanel } from '@/features/terminal/components/loaded-panel'

/** The terminal behind its loading boundary. The wait looks like the panel's own opening state. */
export function DeferredTerminalPanel(props: ComponentProps<typeof LoadedTerminalPanel>) {
  return (
    <Suspense
      fallback={
        <div className={cn('relative flex items-center justify-center', props.className)}>
          <RingLoader label='Opening terminal' className='text-muted-foreground size-6' />
        </div>
      }
    >
      <LoadedTerminalPanel {...props} />
    </Suspense>
  )
}
