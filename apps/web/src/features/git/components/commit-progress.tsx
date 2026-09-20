import { useQueryClient } from '@tanstack/react-query'
import { useStore } from 'zustand'
import { cn } from '@workspace/ui/lib/utils'
import { useLayoutEffect, useRef } from 'react'

import {
  selectCommitProgress,
  commitProgressStoreFor,
} from '@/features/git/state/commit-progress-store'

/**
 * What the repository's hooks are saying, while they say it.
 *
 * Hooks write status to stderr by convention, so a stderr line here is not an
 * error and must not be painted like one — the exit code is the verdict, and it
 * has not arrived yet.
 */
export function CommitProgress({ rootPath }: { readonly rootPath: string }) {
  const queryClient = useQueryClient()
  const lines = useStore(commitProgressStoreFor(queryClient), (state) =>
    selectCommitProgress(state, rootPath),
  )
  const endRef = useRef<HTMLDivElement>(null)

  // Pinned to the newest line: this is a log of something in flight, and the
  // question it answers is "is it still moving", which only the tail shows.
  useLayoutEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [lines])

  if (lines.length === 0) return null

  return (
    <div
      aria-label='Commit output'
      aria-live='polite'
      className='bg-muted/30 app-scrollbar-thin text-2xs mt-2 max-h-32 overflow-y-auto rounded-lg p-2 font-mono leading-4'
      role='log'
    >
      {lines.map((line, index) => (
        <p
          className={cn(
            'break-all whitespace-pre-wrap',
            line.stream === 'stderr' && 'text-warning',
          )}
          // Output lines have no identity of their own and the list only ever
          // grows at the end, so the index is the position and nothing moves.
          key={index}
        >
          {line.text}
        </p>
      ))}
      <div ref={endRef} />
    </div>
  )
}
