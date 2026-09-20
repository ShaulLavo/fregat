import { stopPropagation as stop } from '@workspace/utils/events'
import { useRef, useState, type KeyboardEvent } from 'react'

import { Input } from '@workspace/ui/components/input'

// Events stop here so the row underneath does not read them as a select, a drag or a kill.
export function TerminalListRowEditor({
  initialTitle,
  onCancel,
  onCommit,
}: {
  readonly initialTitle: string
  readonly onCancel: () => void
  readonly onCommit: (title: string) => void
}) {
  const [title, setTitle] = useState(initialTitle)
  // Unmounting the field can fire a trailing blur; once settled it must not commit.
  const settledRef = useRef(false)

  function settle(finish: () => void) {
    if (settledRef.current) return

    settledRef.current = true
    finish()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      settle(() => onCommit(title))
      return
    }
    if (event.key !== 'Escape') return

    event.preventDefault()
    settle(onCancel)
  }

  return (
    <Input
      aria-label='Terminal name'
      autoFocus
      className='h-(--density-control-height-sm) min-w-0 flex-1 px-1'
      value={title}
      onBlur={() => settle(() => onCommit(title))}
      onChange={(event) => setTitle(event.target.value)}
      onClick={stop}
      onDoubleClick={stop}
      onFocus={(event) => event.target.select()}
      onKeyDown={handleKeyDown}
      onPointerDown={stop}
    />
  )
}
