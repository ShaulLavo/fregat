import type { ComponentProps, HTMLAttributes, ReactElement, Ref } from 'react'

import { listRowClassName } from '@workspace/ui/patterns/list-row-classes'
import { assignRef } from '@workspace/ui/lib/assign-ref'
import { playClickFeedback } from '@workspace/ui/patterns/feedback-layer'

type RowElement = HTMLDivElement | HTMLButtonElement | HTMLLIElement

export type ListRowProps = HTMLAttributes<RowElement> & {
  as?: 'div' | 'button' | 'li'
  ref?: Ref<RowElement>
  selected?: boolean
  marked?: boolean
  disabled?: boolean
  interactive?: boolean
  'data-feedback'?: 'tap' | 'tick' | 'silent'
  /** Draws the start-edge bar while the row is selected. */
  selectedBar?: boolean
  /** The list's keyboard cursor: ringed while focus is inside the `group/listbox` ancestor. */
  cursor?: boolean
  /** A roving tab stop for a list whose rows take DOM focus; rows of a `useListbox` list leave it -1. */
  tabIndex?: number
  type?: ComponentProps<'button'>['type']
}

type RowStateProps = Pick<
  ListRowProps,
  'selected' | 'marked' | 'disabled' | 'interactive' | 'selectedBar' | 'cursor' | 'data-feedback'
>

export function ListRow(
  props: ComponentProps<'button'> & RowStateProps & { as: 'button' },
): ReactElement
export function ListRow(props: ComponentProps<'li'> & RowStateProps & { as: 'li' }): ReactElement
export function ListRow(props: ComponentProps<'div'> & RowStateProps & { as?: 'div' }): ReactElement
export function ListRow({
  as: Component = 'div',
  selected,
  marked = false,
  disabled = false,
  interactive = true,
  selectedBar = false,
  cursor = false,
  className,
  role,
  ref,
  tabIndex = -1,
  type,
  onClick,
  onDoubleClick,
  onClickCapture,
  'data-feedback': feedback,
  ...props
}: ListRowProps) {
  const acceptsSelected =
    role === 'option' || role === 'treeitem' || role === 'tab' || role === 'row'
  const unavailable =
    disabled || props['aria-disabled'] === true || props['aria-disabled'] === 'true'
  const actionable = Component === 'button' || Boolean(onClick || onDoubleClick)

  return (
    <Component
      {...props}
      ref={(element: RowElement | null) => assignRef(ref, element)}
      role={role}
      type={Component === 'button' ? (type ?? 'button') : undefined}
      tabIndex={tabIndex}
      data-slot='list-row'
      data-feedback={feedback ?? (actionable ? 'tick' : undefined)}
      data-row-press={actionable && !unavailable ? '' : undefined}
      data-marked={marked || undefined}
      data-selected={acceptsSelected ? undefined : selected}
      aria-selected={acceptsSelected ? (selected ?? props['aria-selected']) : undefined}
      aria-disabled={disabled || props['aria-disabled'] || undefined}
      disabled={Component === 'button' ? disabled : undefined}
      className={listRowClassName({
        interactive,
        selectedBar: selectedBar && selected === true,
        cursor,
        className,
      })}
      onClick={unavailable ? undefined : onClick}
      onDoubleClick={unavailable ? undefined : onDoubleClick}
      onClickCapture={(event) => {
        onClickCapture?.(event)
        playClickFeedback(event.nativeEvent, event.currentTarget)
      }}
    />
  )
}
