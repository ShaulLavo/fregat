import type { ScrollBoxRenderable } from '@opentui/core'
import { useKeyboard } from '@opentui/react'
import { useRef, type ReactNode } from 'react'
import { useCommands } from '@/commands/hooks/use-commands'

export function WorktreeDescription({
  children,
  owner,
}: {
  readonly children: ReactNode
  readonly owner: 'worktree-actions' | 'worktree-cleanup-confirmation'
}) {
  const scroll = useRef<ScrollBoxRenderable>(null)
  const commands = useCommands()
  useKeyboard((event) => {
    if (event.defaultPrevented || event.ctrl || event.meta || event.shift) return
    if (commands.focus.getSnapshot().current?.widgetId !== owner) return
    if (event.name !== 'pageup' && event.name !== 'pagedown') return
    if (!scroll.current?.handleKeyPress(event)) return
    event.preventDefault()
  })
  return (
    <scrollbox
      id='worktree-description'
      ref={scroll}
      flexGrow={1}
      flexBasis={0}
      minHeight={1}
      scrollX={false}
      contentOptions={{ flexDirection: 'column' }}
      // The native scrollbar can cover the last wrapped column; paging needs the full text width.
      verticalScrollbarOptions={{ visible: false }}
    >
      {children}
    </scrollbox>
  )
}
