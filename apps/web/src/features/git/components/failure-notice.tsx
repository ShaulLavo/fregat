import { ChatCircleIcon, XIcon } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { useState } from 'react'

import { ToolbarButton } from '@/components/toolbar-button'

import { useAttachToComposer } from '@/features/chat/hooks/use-attach-to-composer'
import { useLatestFailure } from '@/features/git/hooks/use-latest-failure'
import {
  commitProgressStoreFor,
  selectCommitProgress,
} from '@/features/git/state/commit-progress-store'
import { gitFailureLabel, gitFailurePrompt } from '@/features/git/utils/failure-prompt'

/** The last git step that failed, with a hand-off to the agent. A retry replaces it. */
export function FailureNotice({ rootPath }: { readonly rootPath: string }) {
  const failure = useLatestFailure()
  const queryClient = useQueryClient()
  const { attachText } = useAttachToComposer()
  const [dismissedId, setDismissedId] = useState<number | null>(null)

  if (!failure || failure.mutationId === dismissedId) return null

  const current = failure
  const title = `${gitFailureLabel(current.operation)} failed`

  function fixWithAgent() {
    // Only a commit streams output, and its lines are what the hook rejected.
    const progress = commitProgressStoreFor(queryClient).getState()
    const lines = current.operation === 'commit' ? selectCommitProgress(progress, rootPath) : []
    const prompt = gitFailurePrompt(
      current,
      rootPath,
      lines.map((line) => line.text),
    )
    if (attachText('git-failure', prompt)) setDismissedId(current.mutationId)
  }

  return (
    <div className='bg-destructive/10 mx-(--bar-padding-x) mt-2 rounded-lg p-2' role='alert'>
      <div className='flex items-center gap-(--density-gap-tight)'>
        <p className='text-destructive min-w-0 flex-1 text-xs font-medium'>{title}</p>
        <ToolbarButton label='Dismiss' onClick={() => setDismissedId(current.mutationId)}>
          <XIcon />
        </ToolbarButton>
      </div>
      <p className='text-muted-foreground line-clamp-2 text-xs' title={current.message}>
        {current.message}
      </p>
      <Button className='mt-1' onClick={fixWithAgent} size='sm' variant='ghost'>
        <ChatCircleIcon data-icon='inline-start' />
        Fix with agent
      </Button>
    </div>
  )
}
