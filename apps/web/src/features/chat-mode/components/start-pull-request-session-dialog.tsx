import { parsePullRequestReference } from '@workspace/contracts'
import { selectWorktreeAtPath } from '@workspace/client-core/chat/selectors'
import { resolveChatModelSelection } from '@workspace/client-core/chat/providers/selection'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Spinner } from '@workspace/ui/components/spinner'
import { useId, useState } from 'react'

import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { providerListQueryOptions } from '@/lib/provider-query'
import { useStartPullRequestSessionMutation } from '@/features/chat-mode/hooks/use-start-pull-request-session-mutation'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'

/** A pull request by URL, number or checkout command, opened as a session in its own worktree. */
export function StartPullRequestSessionDialog({
  onOpenChange,
  open,
  rootPath,
}: {
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
  readonly rootPath: string | null
}) {
  const id = useId()
  const environmentId = useEnvironmentId()
  const start = useStartPullRequestSessionMutation()
  const [reference, setReference] = useState('')
  const worktree = useActiveChatProjection((slice) =>
    rootPath === null ? undefined : selectWorktreeAtPath(slice, rootPath),
  )
  const project = useActiveChatProjection((slice) =>
    worktree ? slice.projectById[worktree.projectId] : undefined,
  )
  const checkout = worktree && project ? { worktree, project } : null
  const providers = useQuery(providerListQueryOptions())
  const modelSelection = resolveChatModelSelection(
    providers.data?.providers,
    checkout?.project.defaultModelSelection ?? null,
  )
  const number = parsePullRequestReference(reference)
  let problem: string | null = null
  if (!checkout) problem = 'Open a project checkout to start from its pull requests.'
  else if (providers.isError) problem = 'Could not load providers.'
  else if (!providers.isPending && !modelSelection)
    problem = 'No provider is ready to run the session.'
  const ready =
    number !== null &&
    modelSelection !== null &&
    problem === null &&
    !providers.isPending &&
    !start.isPending

  function submit() {
    if (!checkout || !modelSelection) return
    start.mutate(
      { environmentId, worktreeId: checkout.worktree.id, reference, modelSelection },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Start from pull request</DialogTitle>
          <DialogDescription>
            A new session in its own worktree at the pull request's head. Pushes go to its branch.
          </DialogDescription>
        </DialogHeader>
        <form
          className='flex flex-col gap-3'
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) submit()
          }}
        >
          <div className='flex flex-col gap-1'>
            <label
              className='text-muted-foreground text-2xs font-medium'
              htmlFor={`${id}-reference`}
            >
              Pull request
            </label>
            <Input
              id={`${id}-reference`}
              autoCapitalize='off'
              autoComplete='off'
              autoCorrect='off'
              disabled={start.isPending}
              placeholder='Pull request URL or number'
              spellCheck={false}
              value={reference}
              onChange={(event) => setReference(event.currentTarget.value)}
            />
          </div>
          {checkout && providers.isPending ? (
            <p className='text-muted-foreground flex items-center gap-1.5 text-xs'>
              <Spinner size='xs' /> Checking providers…
            </p>
          ) : null}
          {problem ? <p className='text-muted-foreground text-xs'>{problem}</p> : null}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type='submit' disabled={!ready}>
              {start.isPending ? <Spinner /> : null}
              {number === null ? 'Start' : `Start from #${number}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
