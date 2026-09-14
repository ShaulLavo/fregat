/** @jsxImportSource react */

import { memo, type JSX, type ReactNode } from 'react'

import { Fruncate } from './Fruncate'
import type { OverflowTextProps } from './OverflowText'
import { Truncate } from './Truncate'
import {
  resolveOverflowTextSplit,
  type OverflowTextSplit,
  type OverflowTextSplitOffset,
} from '../utils/render/overflowTextSplit'

type AllowableContentGroups =
  | {
      children?: never
      contents: [ReactNode, ReactNode]
    }
  | {
      contents?: never
      children: string
    }

export type MiddleTruncateProps = Omit<OverflowTextProps, 'mode' | 'children'> &
  AllowableContentGroups & {
    minimumLength?: number
    priority?: 'start' | 'end' | 'equal'
    split?:
      | 'center'
      | 'extension'
      | 'leaf-path'
      | number
      | OverflowTextSplitOffset
      | OverflowTextSplit
  }

// Unchanged row names should not repeat splitting or render both segments.
export const MiddleTruncate = memo(function MiddleTruncate({
  children,
  contents,
  priority = 'end',
  split = 'center',
  minimumLength = 12,
  className,
  style,
  ...props
}: MiddleTruncateProps): JSX.Element | null {
  let firstSegment: ReactNode = null
  let secondSegment: ReactNode = null

  if (Array.isArray(contents)) {
    if (contents.length !== 2) {
      console.error('MiddleTruncate: contents must be an array of two items')
      return null
    }
    firstSegment = <Truncate {...props}>{contents[0]}</Truncate>
    secondSegment = <Fruncate {...props}>{contents[1]}</Fruncate>
  }

  if (!Array.isArray(contents)) {
    if (typeof children !== 'string') {
      console.error('MiddleTruncate: children must be a string')
      return null
    }
    if (children.length === 0) return <div className={className} style={style}></div>
    if (children.length < minimumLength && priority === 'end') {
      return (
        <Fruncate {...props} className={className} style={style}>
          {children}
        </Fruncate>
      )
    }
    if (children.length < minimumLength) {
      return (
        <Truncate {...props} className={className} style={style}>
          {children}
        </Truncate>
      )
    }

    const splitResolution = resolveOverflowTextSplit(split)
    const [firstHalfMessage, secondHalfMessage] = splitResolution.split(children, {
      priority,
      splitIndex: splitResolution.splitIndex,
      splitOffset: splitResolution.splitOffset,
      variant: props.variant,
    })
    const firstCanBeSimple =
      priority === 'equal' && firstHalfMessage.length < secondHalfMessage.length
    const secondCanBeSimple =
      priority === 'equal' && firstHalfMessage.length >= secondHalfMessage.length
    const firstPropOverrides: Partial<OverflowTextProps> = {}
    const secondPropOverrides: Partial<OverflowTextProps> = {}
    if (firstCanBeSimple) firstPropOverrides.marker = ''
    if (secondCanBeSimple) secondPropOverrides.marker = ''

    firstSegment = (
      <Truncate {...props} {...firstPropOverrides}>
        {firstHalfMessage}
      </Truncate>
    )
    secondSegment = (
      <Fruncate {...props} {...secondPropOverrides}>
        {secondHalfMessage}
      </Fruncate>
    )
  }

  return (
    <div data-truncate-group-container='middle' className={className} style={style}>
      <div
        data-truncate-segment-priority={priority === 'start' || priority === 'equal' ? '1' : '2'}
      >
        {firstSegment}
      </div>
      <div data-truncate-segment-priority={priority === 'end' || priority === 'equal' ? '1' : '2'}>
        {secondSegment}
      </div>
    </div>
  )
})
