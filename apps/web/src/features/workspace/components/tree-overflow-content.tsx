/** @jsxImportSource react */

import type { JSX } from 'react'

import type { OverflowTextProps } from '@/features/workspace/components/tree-overflow-text'

export function OverflowContent({ children, mode }: OverflowTextProps): JSX.Element {
  const visibleChildren = mode === 'fruncate' ? <span>{children}</span> : children
  const overflowChildren = mode === 'fruncate' ? <span>{children}</span> : children

  return (
    <div>
      <div data-truncate-content='visible'>{visibleChildren}</div>
      <div data-truncate-content='overflow' aria-hidden>
        {overflowChildren}
      </div>
    </div>
  )
}
