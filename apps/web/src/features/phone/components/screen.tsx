import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

import { ModuleLoadError } from '@/components/module-load-error'
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import type { PhoneLevel } from '@/features/phone/utils/level'
import { screenQueryOptions, type ScreenProps } from '@/features/phone/utils/screen-query'

/** The screen on top of the stack; the one below stays up until the next one's chunk is in. */
export function Screen({ level, ...props }: ScreenProps & { readonly level: PhoneLevel }) {
  const wanted = useQuery(screenQueryOptions(level), resourceQueryClient)
  const shown = useHeldUntilReady(level, wanted.isSuccess)
  const query = useQuery(screenQueryOptions(shown), resourceQueryClient)
  const frameRef = useRef<HTMLDivElement>(null)
  const previousShown = useRef(shown)
  // A pushed or popped screen takes focus, so a screen reader starts on it, not on the body.
  useEffect(() => {
    if (shown === previousShown.current) return
    previousShown.current = shown
    frameRef.current?.focus({ preventScroll: true })
  }, [shown])

  if (wanted.isError)
    return (
      <ModuleLoadError
        className='min-h-0 flex-1'
        label='this screen'
        onRetry={() => void wanted.refetch()}
      />
    )
  if (query.isPending)
    return (
      <LoadingState label='Opening screen' className='flex min-h-0 flex-1 flex-col'>
        <div className='h-(--bar-height) shrink-0' />
        <div className='flex flex-col gap-(--density-section-gap) p-(--density-section-padding)'>
          <div className='skeleton-sweep h-4 w-48 rounded-md' />
          <div className='skeleton-sweep h-4 w-32 rounded-md' />
        </div>
      </LoadingState>
    )
  if (query.isError)
    return (
      <ModuleLoadError
        className='min-h-0 flex-1'
        label='this screen'
        onRetry={() => void query.refetch()}
      />
    )

  const View = query.data
  return (
    <div
      className='flex min-h-0 flex-1 flex-col outline-none'
      data-phone-level={shown}
      ref={frameRef}
      tabIndex={-1}
    >
      <RenderErrorBoundary label='This screen' resetKeys={[shown]}>
        <View {...props} />
      </RenderErrorBoundary>
    </div>
  )
}
