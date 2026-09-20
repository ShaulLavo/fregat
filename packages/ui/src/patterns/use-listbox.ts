import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react'

import {
  enabledListboxIndex,
  listboxKeyAction,
  typeaheadListboxIndex,
  type ListboxItem,
  type ListboxRole,
} from '@workspace/ui/patterns/listbox-keys'

export type UseListboxOptions<Id extends string> = {
  role: ListboxRole
  items: readonly ListboxItem<Id>[]
  activeId: Id | null
  onActiveChange: (id: Id) => void
  onCommit: (id: Id) => void
  onSelect?: (id: Id) => void
  onCollapse?: (id: Id) => void
  onExpand?: (id: Id) => void
  pageSize?: number
  typeahead?: boolean
  scrollToIndex?: (index: number) => void
  containerRef?: RefObject<HTMLDivElement | null>
  onActiveKeyDown?: (event: KeyboardEvent<HTMLDivElement>, id: Id) => void
}

export function useListbox<Id extends string>({
  role,
  items,
  activeId,
  onActiveChange,
  onCommit,
  onSelect = onCommit,
  onCollapse,
  onExpand,
  pageSize,
  typeahead = false,
  scrollToIndex,
  containerRef,
  onActiveKeyDown,
}: UseListboxOptions<Id>) {
  const internalRef = useRef<HTMLDivElement>(null)
  const ref = containerRef ?? internalRef
  const prefix = useId()
  const typed = useRef({ query: '', timestamp: 0 })
  const interactions = useRef({ items, onActiveChange })
  useLayoutEffect(() => {
    interactions.current = { items, onActiveChange }
  }, [items, onActiveChange])
  const activeIndex = items.findIndex((item) => item.id === activeId && !item.disabled)
  const cursorIndex = activeIndex < 0 ? enabledListboxIndex(items, 0, 1) : activeIndex
  const cursor = items[cursorIndex]

  function rowId(id: Id) {
    return `${prefix}-${id}`
  }

  const revealCursor = useEffectEvent(() => {
    if (cursorIndex < 0 || !cursor) return
    if (scrollToIndex) {
      scrollToIndex(cursorIndex)
      return
    }
    document.getElementById(`${prefix}-${cursor.id}`)?.scrollIntoView?.({ block: 'nearest' })
  })

  useEffect(() => {
    revealCursor()
  }, [cursorIndex, cursor?.id, prefix])

  function moveTo(index: number) {
    const item = items[index]
    if (!item || item.disabled) return
    onActiveChange(item.id)
  }

  function handleTypeahead(event: KeyboardEvent<HTMLDivElement>) {
    if (!typeahead || event.key.length !== 1 || event.key === ' ') return
    const now = Date.now()
    const previous = now - typed.current.timestamp > 700 ? '' : typed.current.query
    const query = previous + event.key
    typed.current = { query, timestamp: now }
    let index = typeaheadListboxIndex(items, cursorIndex, query)
    if (index < 0 && [...query].every((character) => character === event.key)) {
      index = typeaheadListboxIndex(items, cursorIndex, event.key)
    }
    if (index < 0) return
    event.preventDefault()
    moveTo(index)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || ignoresListboxKey(event)) return
    if (cursor) onActiveKeyDown?.(event, cursor.id)
    if (event.defaultPrevented) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const height =
      ref.current?.querySelector<HTMLElement>('[data-slot="list-row"]')?.offsetHeight ?? 0
    const visibleCount = height > 0 ? Math.floor((ref.current?.clientHeight ?? height) / height) : 1
    const action = listboxKeyAction({
      key: event.key,
      role,
      count: items.length,
      activeIndex: cursorIndex,
      pageSize: pageSize ?? visibleCount,
      canCollapse: cursor?.hasChildren ?? cursor?.expanded !== undefined,
      isCollapsed: !cursor?.expanded,
    })
    if (action.kind === 'none') return handleTypeahead(event)
    event.preventDefault()
    if (action.kind === 'move') {
      const direction = action.index < cursorIndex || event.key === 'End' ? -1 : 1
      moveTo(enabledListboxIndex(items, action.index, direction))
      return
    }
    if (!cursor) return
    if (action.kind === 'commit') onCommit(cursor.id)
    if (action.kind === 'select') onSelect(cursor.id)
    if (action.kind === 'collapse') onCollapse?.(cursor.id)
    if (action.kind === 'expand') onExpand?.(cursor.id)
    if (action.kind === 'parent') moveTo(items.findIndex((item) => item.id === cursor.parentId))
    if (action.kind === 'child')
      moveTo(items.findIndex((item) => item.parentId === cursor.id && !item.disabled))
  }

  // Stable bindings keep context consumers from rerendering on unrelated parent updates.
  const rowBindings = useCallback(
    (id: Id) => ({
      id: `${prefix}-${id}`,
      tabIndex: -1,
      onClick: (event: MouseEvent<HTMLElement>) => {
        if (isRowControl(event.target, event.currentTarget)) return
        const current = interactions.current
        const item = current.items.find((candidate) => candidate.id === id)
        if (item && !item.disabled) current.onActiveChange(id)
        ref.current?.focus({ preventScroll: true })
      },
      onMouseDown: (event: MouseEvent<HTMLElement>) => {
        if (isRowControl(event.target, event.currentTarget)) return
        event.preventDefault()
        ref.current?.focus({ preventScroll: true })
      },
    }),
    [prefix, ref],
  )

  const focus = useCallback(() => ref.current?.focus({ preventScroll: true }), [ref])

  const cursorId = cursor?.id
  const rowProps = useCallback(
    (id: Id) => ({
      ...rowBindings(id),
      'aria-selected': cursorId === id,
      'data-active': cursorId === id || undefined,
    }),
    [cursorId, rowBindings],
  )

  return {
    activeIndex: cursorIndex,
    activeId: cursor?.id ?? null,
    containerProps: {
      ref,
      role,
      tabIndex: 0,
      className: 'focus-ring-inset',
      'aria-activedescendant': cursor ? rowId(cursor.id) : undefined,
      onKeyDown,
      onFocus: () => {
        if (activeIndex < 0 && cursor) onActiveChange(cursor.id)
      },
    },
    rowProps,
    rowBindings,
    focus,
  }
}

function isRowControl(target: EventTarget | null, row: HTMLElement) {
  if (!(target instanceof Element)) return false
  const control = target.closest(
    'button, input, textarea, select, a, [contenteditable="true"], [role="button"]',
  )
  return control !== null && control !== row
}

function ignoresListboxKey(event: KeyboardEvent<HTMLDivElement>) {
  const target = event.target
  if (!(target instanceof Element)) return false
  if (target.closest('[aria-pressed="true"], [data-dragging="true"]')) return true
  const row = target.closest<HTMLElement>('[data-slot="list-row"]')
  return isRowControl(target, row ?? event.currentTarget)
}
