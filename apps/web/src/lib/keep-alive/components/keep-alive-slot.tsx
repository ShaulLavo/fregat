import { useLayoutEffect, useRef } from 'react'
import { cn } from '@workspace/ui/lib/utils'

import { useKeepAliveStore } from '@/lib/keep-alive/hooks/use-keep-alive-store'
import type { KeptRender } from '@/lib/keep-alive/state/store'

/**
 * Shows kept content here. Mounting the first slot for an `id` creates the
 * content; unmounting a slot parks it. `scope` groups ids for `useKeptIds`.
 */
export function KeepAliveSlot({
  children,
  className,
  id,
  scope,
}: {
  readonly children: KeptRender
  readonly className?: string
  readonly id: string
  readonly scope: string
}) {
  const store = useKeepAliveStore()
  const containerRef = useRef<HTMLDivElement>(null)

  // Every render: the content's props live in the caller's closure.
  useLayoutEffect(() => {
    store.publish(id, scope, children)
  })

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    store.attach(id, container)
    return () => store.park(id)
  }, [id, store])

  return <div className={cn('size-full min-h-0 min-w-0', className)} ref={containerRef} />
}
