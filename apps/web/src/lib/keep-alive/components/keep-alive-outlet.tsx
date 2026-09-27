import { useLayoutEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { createPortal } from 'react-dom'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

import type { KeepAliveStore } from '@/lib/keep-alive/state/store'

export function KeepAliveOutlet({ store }: { readonly store: KeepAliveStore }) {
  const entries = useStore(store.entries)
  const parkingRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    store.setParking(parkingRef.current)
    return () => store.setParking(null)
  }, [store])

  return (
    <>
      {/* `hidden` measures 0x0, which a terminal reads as "no size yet" rather than as a resize. */}
      <div hidden ref={parkingRef} />
      {entries.map((entry) =>
        createPortal(
          <RenderErrorBoundary label='Kept content' resetKeys={[entry.id]}>
            {entry.render(entry.attached)}
          </RenderErrorBoundary>,
          entry.element,
          entry.id,
        ),
      )}
    </>
  )
}
