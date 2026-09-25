import type { VirtualListHandle } from '@workspace/ui/patterns/virtual-list'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { useRef } from 'react'

/** A studio column: arrows move the choice and the app repaints; there is nothing to commit. */
export function useStudioList({
  items,
  activeId,
  onActiveChange,
}: {
  items: readonly { id: string; label: string }[]
  activeId: string | null
  onActiveChange: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const virtualRef = useRef<VirtualListHandle>(null)
  const list = useListbox({
    role: 'listbox',
    containerRef,
    items,
    activeId,
    onActiveChange,
    onCommit: () => {},
    onSelect() {},
    typeahead: true,
    scrollToIndex: (index) => virtualRef.current?.scrollToIndex(index, { align: 'auto' }),
  })
  return { containerRef, virtualRef, list }
}
