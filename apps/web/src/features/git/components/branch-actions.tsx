import { ArrowSquareOutIcon, GitPullRequestIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import type {
  GitBranchRemoteState,
  GitPullRequest,
  GitPullRequestState,
} from '@workspace/contracts'

import { useBranchRemoteState } from '@/features/git/hooks/use-branch-remote-state'
import { useCreatePullRequestMutation } from '@/features/git/hooks/use-create-pull-request-mutation'
import { usePullRequestState } from '@/features/git/hooks/use-pull-request-state'
import { usePushRemoteMutation } from '../hooks/use-push-remote-mutation'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { changeRequestLabel } from '@/features/git/utils/forge-terms'

/**
 * Publish, push and open-a-pull-request, in the header where the branch already
 * is. Everything here is conditional on what the branch actually needs: a branch
 * with nothing to push shows no push button, and Create is offered only when we
 * were able to ask the forge and it said there is none.
 */
export function BranchActions({
  pullRequestTitle,
  rootPath,
}: {
  /** What a new pull request is called. The session's own title, not the branch. */
  readonly pullRequestTitle: string
  readonly rootPath: string
}) {
  const { data: state } = useBranchRemoteState(rootPath)
  // Its own query, and never awaited by the rest: reading a pull request shells
  // out to the forge CLI, and Publish must not wait on the network to appear.
  const { data: pullRequestState } = usePullRequestState(rootPath)
  const push = usePushRemoteMutation(rootPath)
  const createPullRequest = useCreatePullRequestMutation(rootPath)
  if (!state?.branch) return null

  return (
    <span className='flex shrink-0 items-center gap-1'>
      {pushLabel(state) ? (
        <Button
          className='text-2xs'
          disabled={push.isPending}
          size='sm'
          type='button'
          variant='ghost'
          onClick={() => push.mutate()}
        >
          <UploadSimpleIcon className='size-(--icon-size-sm)' />
          {pushLabel(state)}
        </Button>
      ) : null}
      {pullRequestState?.pullRequest ? (
        // buttonVariants rather than <Button render={<a />}>: Base UI's Button stamps
        // type/role onto whatever it renders, which would cost this link its link semantics.
        <a
          className={cn(
            buttonVariants({ size: 'sm', variant: 'ghost' }),
            'text-2xs',
            pullRequestToneClass(pullRequestState.pullRequest.state),
          )}
          href={pullRequestState.pullRequest.url}
          rel='noreferrer'
          target='_blank'
        >
          <GitPullRequestIcon className='size-(--icon-size-sm)' />
          <span className='tabular-nums'>#{pullRequestState.pullRequest.number}</span>
          <ArrowSquareOutIcon className='size-(--icon-size-sm) opacity-60' />
        </a>
      ) : null}
      {canCreatePullRequest(state, pullRequestState) ? (
        <Button
          className='text-2xs'
          disabled={createPullRequest.isPending}
          size='sm'
          type='button'
          variant='ghost'
          onClick={() => createPullRequest.mutate({ title: pullRequestTitle })}
        >
          <GitPullRequestIcon className='size-(--icon-size-sm)' />
          {changeRequestLabel(pullRequestState?.forge)}
        </Button>
      ) : null}
    </span>
  )
}

/**
 * A branch nobody has pushed needs publishing even with nothing ahead — its
 * upstream does not exist yet, which is a different job from sending commits.
 */
function pushLabel(state: GitBranchRemoteState) {
  if (!state.hasUpstream) return 'Publish'
  if (state.ahead > 0) return `Push ${state.ahead}`

  return null
}

/**
 * Only when the forge actually answered. `support` short of `ready` means we could
 * not ask, and offering Create then is how someone ends up trying to open a
 * second pull request for a branch that already has one.
 */
function canCreatePullRequest(
  branch: GitBranchRemoteState,
  pullRequest: GitPullRequestState | undefined,
) {
  if (!branch.hasUpstream) return false

  return pullRequest?.support === 'ready' && !pullRequest.pullRequest
}

function pullRequestToneClass(state: GitPullRequest['state']) {
  if (state === 'merged') return 'text-info'
  if (state === 'closed') return 'text-muted-foreground'

  return 'text-success'
}
