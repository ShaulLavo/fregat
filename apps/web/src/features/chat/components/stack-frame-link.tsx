import type { MouseEvent } from 'react'

import { useOpenFileReference } from '@/features/chat/hooks/use-open-file-reference'
import { resolveInlineCodeFileReference } from '@/features/chat/utils/markdown-file-links'
import type { StackFrame } from '@/features/chat/utils/stack-frames'

/** A frame in tool output that opens the editor at its line. */
export function StackFrameLink({ frame, text }: { frame: StackFrame; text: string }) {
  const { openFileReference, rootPath } = useOpenFileReference()

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    // Relative frames resolve against the chat's project, as transcript file links do.
    const position = `${frame.path}:${frame.line}${frame.column === null ? '' : `:${frame.column}`}`
    openFileReference(
      resolveInlineCodeFileReference(position, rootPath) ?? {
        column: frame.column,
        label: frame.path,
        line: frame.line,
        path: frame.path,
      },
    )
  }

  return (
    <a
      className='text-foreground hover:text-info cursor-pointer underline underline-offset-2 transition-colors'
      data-stack-frame={`${frame.path}:${frame.line}`}
      href={frame.path}
      onClick={handleClick}
    >
      {text}
    </a>
  )
}
