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
  type?: ComponentProps<'button'>['type']
}

type RowStateProps = Pick<ListRowProps, 'selected' | 'marked' | 'disabled' | 'interactive'>

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
  className,
  role,
  ref,
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
      tabIndex={-1}
      data-slot='list-row'
      data-marked={marked || undefined}
      data-selected={acceptsSelected ? undefined : selected}
      aria-selected={acceptsSelected ? (selected ?? props['aria-selected']) : undefined}
      aria-disabled={disabled || props['aria-disabled'] || undefined}
      className={listRowClassName({ interactive, className })}
      onClick={disabled ? undefined : onClick}
    />
  )
}
