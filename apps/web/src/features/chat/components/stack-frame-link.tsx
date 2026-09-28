import type { MouseEvent } from 'react'

import { useOpenFileReference } from '@/features/chat/hooks/use-open-file-reference'
import { resolveInlineCodeFileReference } from '@/features/chat/utils/markdown-file-links'
import type { StackFrame } from '@/features/chat/utils/stack-frames'

/** A frame in tool output that opens the editor at its line. */
export function StackFrameLink({ frame, text }: { frame: StackFrame; text: string }) {
  const { openFileReference, prepareFileReference, rootPath } = useOpenFileReference()

  // Relative frames resolve against the chat's project, as transcript file links do.
  function frameReference() {
    const position = `${frame.path}:${frame.line}${frame.column === null ? '' : `:${frame.column}`}`
    return (
      resolveInlineCodeFileReference(position, rootPath) ?? {
        column: frame.column,
        label: frame.path,
        line: frame.line,
        path: frame.path,
      }
    )
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    openFileReference(frameReference())
  }

  return (
    <a
      className='text-foreground hover:text-info cursor-pointer underline underline-offset-2 transition-colors'
      data-stack-frame={`${frame.path}:${frame.line}`}
      href={frame.path}
      onClick={handleClick}
      onPointerEnter={() => prepareFileReference(frameReference())}
    >
      {text}
    </a>
  )
}
