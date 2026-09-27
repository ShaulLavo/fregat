import type { ComponentProps, HTMLAttributes, ReactElement, Ref } from 'react'

import { listRowClassName } from '@workspace/ui/patterns/list-row-classes'
import { assignRef } from '@workspace/ui/lib/assign-ref'

type RowElement = HTMLDivElement | HTMLButtonElement | HTMLLIElement

export type ListRowProps = HTMLAttributes<RowElement> & {
  as?: 'div' | 'button' | 'li'
  ref?: Ref<RowElement>
  selected?: boolean
  marked?: boolean
  disabled?: boolean
  interactive?: boolean
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
  'selected' | 'marked' | 'disabled' | 'interactive' | 'selectedBar' | 'cursor'
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
  ...props
}: ListRowProps) {
  const acceptsSelected =
    role === 'option' || role === 'treeitem' || role === 'tab' || role === 'row'

  return (
    <Component
      {...props}
      ref={(element: RowElement | null) => assignRef(ref, element)}
      role={role}
      type={Component === 'button' ? (type ?? 'button') : undefined}
      tabIndex={tabIndex}
      data-slot='list-row'
      data-marked={marked || undefined}
      data-selected={acceptsSelected ? undefined : selected}
      aria-selected={acceptsSelected ? (selected ?? props['aria-selected']) : undefined}
      aria-disabled={disabled || props['aria-disabled'] || undefined}
      className={listRowClassName({
        interactive,
        selectedBar: selectedBar && selected === true,
        cursor,
        className,
      })}
      onClick={disabled ? undefined : onClick}
    />
  )
}
