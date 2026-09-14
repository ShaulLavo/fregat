/** @jsxImportSource react */

import { memo, type JSX } from 'react'

import { OverflowText, type OverflowTextProps } from './OverflowText'

// A changed filename can keep the same first segment.
export const Truncate = memo(function Truncate({
  children,
  ...props
}: Omit<OverflowTextProps, 'mode'>): JSX.Element {
  return (
    <OverflowText mode='truncate' {...props}>
      {children}
    </OverflowText>
  )
})
