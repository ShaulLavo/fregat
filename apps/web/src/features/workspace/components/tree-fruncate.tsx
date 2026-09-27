/** @jsxImportSource react */

import { memo, type JSX } from 'react'

import {
  OverflowText,
  type OverflowTextProps,
} from '@/features/workspace/components/tree-overflow-text'

// A changed filename often keeps the same extension segment.
export const Fruncate = memo(function Fruncate({
  children,
  ...props
}: Omit<OverflowTextProps, 'mode'>): JSX.Element {
  return (
    <OverflowText mode='fruncate' {...props}>
      {children}
    </OverflowText>
  )
})
