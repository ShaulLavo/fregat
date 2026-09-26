import { useMutation } from '@tanstack/react-query'
import {
  sessionIdSchema,
  type EnvironmentId,
  type ModelSelection,
  type WorktreeId,
} from '@workspace/contracts'
import * as v from 'valibot'

import { notifyChatCommandError } from '@/features/chat/notify-command-error'
import { startPullRequestSession } from '@/features/chat-mode/transport/pull-request-session'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { getNavigation } from '@/state/navigation-binding'

/** Starts a session on a pull request's head, in its own worktree, and opens it. */
export function useStartPullRequestSessionMutation() {
  return useMutation({
    mutationFn: (input: {
      environmentId: EnvironmentId
      worktreeId: WorktreeId
      reference: string
      modelSelection: ModelSelection
    }) => startPullRequestSession(input),
    mutationKey: chatModeMutationKeys.pullRequestSession(),
    onError: (error) => notifyChatCommandError(error, 'Could not start from the pull request'),
    onSuccess: (result, input) =>
      getNavigation().openChat({
        environmentId: input.environmentId,
        sessionId: v.parse(sessionIdSchema, result.sessionId),
        surface: 'main',
      }),
  })
}
