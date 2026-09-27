import type { VirtualListHandle } from '@workspace/ui/patterns/virtual-list'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { useRef, useState, type MouseEvent } from 'react'

/**
 * A list of choices. `live` chooses as the cursor moves, for a draft that commits elsewhere.
 * Otherwise the cursor moves locally and only Enter, Space or a click chooses.
 */
export function useChoiceList({
  items,
  live = false,
  value,
  onChoose,
}: {
  items: readonly { id: string; label: string }[]
  live?: boolean
  value: string | null
  onChoose: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const virtualRef = useRef<VirtualListHandle>(null)
  // Until the cursor first moves, a reveal centres the choice, clear of the list's edge fades.
  const cursorMoved = useRef(false)
  // The cursor belongs to the value it moved from; a new value puts it back on the choice.
  const [local, setLocal] = useState<{ id: string; from: string | null } | null>(null)
  const cursor = !live && local?.from === value ? local.id : value
  const list = useListbox({
    role: 'listbox',
    containerRef,
    items,
    activeId: cursor,
    onActiveChange: (id) => {
      cursorMoved.current = true
      if (live) onChoose(id)
      else setLocal({ id, from: value })
    },
    onCommit: live ? () => {} : onChoose,
    onSelect: live ? () => {} : onChoose,
    typeahead: true,
    scrollToIndex: (index) =>
      virtualRef.current?.scrollToIndex(index, { align: cursorMoved.current ? 'auto' : 'center' }),
  })
  const rowProps = (id: string) => {
    const props = list.rowProps(id)
    if (live) return props
    return {
      ...props,
      onClick: (event: MouseEvent<HTMLElement>) => {
        props.onClick(event)
        onChoose(id)
      },
    }
  }
  return { containerRef, virtualRef, list: { ...list, rowProps } }
}
