import { useCallback, type MouseEvent } from 'react'

import { useOpenFileReference } from '@/features/chat/hooks/use-open-file-reference'
import { resolveInlineCodeFileReference } from '@/features/chat/utils/markdown-file-links'
import { useFileIntentLifetime } from '@/lib/file-open-intent/hooks/use-file-intent-lifetime'
import type { FileOpenIntentTrigger } from '@/lib/file-open-intent/state/service'
import type { StackFrame } from '@/features/chat/utils/stack-frames'

/** A frame in tool output that opens the editor at its line. */
export function StackFrameLink({ frame, text }: { frame: StackFrame; text: string }) {
  const { openFileReference, prepareFileReference, rootPath } = useOpenFileReference()

  const { path, line, column } = frame
  const reference = resolveFrameReference(path, line, column, rootPath)
  // useFileIntentLifetime keys cleanup on these coordinates and captured preparation root.
  const prepare = useCallback(
    (trigger: FileOpenIntentTrigger) =>
      prepareFileReference(resolveFrameReference(path, line, column, rootPath), trigger),
    [prepareFileReference, path, line, column, rootPath],
  )
  const lifetime = useFileIntentLifetime(prepare)

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    openFileReference(reference)
  }

  return (
    <a
      className='text-foreground hover:text-info cursor-pointer underline underline-offset-2 transition-colors'
      data-stack-frame={`${frame.path}:${frame.line}`}
      href={frame.path}
      onClick={handleClick}
      onPointerEnter={lifetime.onPointerEnter}
      onPointerLeave={lifetime.onPointerLeave}
      onFocus={lifetime.onFocus}
      onBlur={lifetime.onBlur}
    >
      {text}
    </a>
  )
}

function resolveFrameReference(
  path: string,
  line: number,
  column: number | null,
  rootPath: string | null,
) {
  const position = `${path}:${line}${column === null ? '' : `:${column}`}`
  return resolveInlineCodeFileReference(position, rootPath) ?? { column, label: path, line, path }
}
