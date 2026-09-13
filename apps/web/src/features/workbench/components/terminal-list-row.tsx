import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TerminalIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'

import { TerminalListRowEditor } from '@/features/workbench/components/terminal-list-row-editor'
import { terminalTabMenu } from '@/features/workbench/utils/terminal-tab-menu'
import { terminalTabLabel, type TerminalTabRecord } from '@/features/workbench/utils/terminal-tabs'
import { MenuSurface } from '@/keymap/menus/components/surface'
import { TabTrailingSlot } from '@/features/workbench/components/tab-trailing-slot'
import { cn } from '@workspace/ui/lib/utils'

const MIDDLE_MOUSE_BUTTON = 1

export function TerminalListRow({
  active,
  tab,
  onClose,
  onRename,
  onSelect,
}: {
  readonly active: boolean
  readonly tab: TerminalTabRecord
  readonly onClose: (tabId: string) => void
  readonly onRename: (tabId: string, name: string) => void
  readonly onSelect: (tabId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const label = terminalTabLabel(tab)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const restoreFocusRef = useRef(false)
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    attributes: { role: 'tab', roleDescription: 'sortable terminal' },
    disabled: editing,
    id: tab.id,
  })
  const menu = terminalTabMenu({
    kill: () => onClose(tab.id),
    rename: () => setEditing(true),
  })

  // The field took focus from the row; hand it back when the field goes.
  function stopEditing() {
    restoreFocusRef.current = true
    setEditing(false)
  }
  useEffect(() => {
    if (editing || !restoreFocusRef.current) return

    restoreFocusRef.current = false
    buttonRef.current?.focus()
  }, [editing])

  // Other keys still reach dnd-kit so Space picks the row up for keyboard reordering.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'F2') {
      event.preventDefault()
      setEditing(true)
      return
    }
    if (event.key === 'Delete') {
      event.preventDefault()
      onClose(tab.id)
      return
    }

    listeners?.onKeyDown?.(event)
  }

  function handleAuxClick(event: MouseEvent<HTMLButtonElement>) {
    if (event.button !== MIDDLE_MOUSE_BUTTON) return

    event.preventDefault()
    onClose(tab.id)
  }

  function commitRename(name: string) {
    stopEditing()
    onRename(tab.id, name)
  }

  const rowClassName = cn(
    'flex h-(--density-control-height-sm) w-full min-w-0 items-center gap-(--density-control-gap) px-(--density-row-padding-x) text-xs',
    active ? 'bg-row-selected text-foreground' : 'text-muted-foreground',
  )

  // A field cannot sit inside a <button>, so the editing row is a plain box.
  if (editing)
    return (
      <div className={rowClassName} data-terminal-tab-id={tab.id} ref={setNodeRef}>
        <TerminalIcon className='size-3.5 shrink-0' />
        <TerminalListRowEditor
          initialTitle={tab.name ?? label}
          onCancel={stopEditing}
          onCommit={commitRename}
        />
      </div>
    )

  // Raw <button>: a full-width list row that also spreads dnd-kit drag listeners.
  const trigger = (
    <button
      {...attributes}
      {...listeners}
      aria-selected={active}
      className={cn(
        rowClassName,
        'group/proof-tab focus-ring-inset cursor-grab touch-none text-left outline-none select-none active:cursor-grabbing',
        !active && 'hover:bg-row-hover hover:text-foreground active:bg-row-active',
        isDragging && 'relative z-10 opacity-60',
      )}
      data-terminal-tab-id={tab.id}
      draggable={false}
      ref={(node) => {
        buttonRef.current = node
        setNodeRef(node)
      }}
      role='tab'
      style={{ transform: CSS.Transform.toString(transform), transition }}
      title={label}
      type='button'
      onAuxClick={handleAuxClick}
      onClick={() => onSelect(tab.id)}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={handleKeyDown}
    >
      <TerminalIcon className='size-3.5 shrink-0' />
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      <TabTrailingSlot
        active={active}
        dirty={false}
        orientation='horizontal'
        title={label}
        onClose={() => onClose(tab.id)}
      />
    </button>
  )

  return <MenuSurface className='w-44' menu={menu} surface='terminal.tab' trigger={trigger} />
}
