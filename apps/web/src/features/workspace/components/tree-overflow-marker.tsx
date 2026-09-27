/** @jsxImportSource react */

import type { JSX, ReactNode } from 'react'

import type { OverflowTextProps } from '@/features/workspace/components/tree-overflow-text'

export function OverflowMarker({
  children,
  marker,
  variant = 'default',
}: OverflowTextProps): JSX.Element {
  let markerContent: ReactNode = null
  if (typeof marker === 'function') {
    markerContent = marker({ children })
  } else if (variant === 'fade') {
    markerContent = <span data-truncate-fade />
  } else {
    markerContent = marker
  }

  return (
    <div aria-hidden data-truncate-marker-cell>
      <div data-truncate-marker>{markerContent}</div>
    </div>
  )
}
