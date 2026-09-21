import { ChatCircleIcon, XIcon } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { useEffect, useState } from 'react'

import { ToolbarButton } from '@/components/toolbar-button'
import { log } from '@/lib/client-logging'

import { useAttachToComposer } from '@/features/chat/hooks/use-attach-to-composer'
import { useLatestFailure } from '@/features/git/hooks/use-latest-failure'
import {
  commitProgressStoreFor,
  selectCommitProgress,
} from '@/features/git/state/commit-progress-store'
import { gitFailureLabel, gitFailurePrompt } from '@/features/git/utils/failure-prompt'

/** The last git step that failed, with a hand-off to the agent. A retry replaces it. */
export function FailureNotice({ rootPath }: { readonly rootPath: string }) {
  const failure = useLatestFailure(rootPath)
  const queryClient = useQueryClient()
  const { attachTextToNewChat } = useAttachToComposer()
  const [dismissedId, setDismissedId] = useState<number | null>(null)

  const shownId = failure && failure.mutationId !== dismissedId ? failure.mutationId : null
  const operation = failure?.operation
  // One event per failure shown, so a report of a missing notice can be checked.
  useEffect(() => {
    if (shownId === null) return

    log.info({ action: 'git.failure_notice', area: 'git', mutationId: shownId, operation })
  }, [operation, shownId])

  if (!failure || shownId === null) return null

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
    void attachTextToNewChat('git-failure', prompt, rootPath).then((attached) => {
      if (attached) setDismissedId(current.mutationId)
    })
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
