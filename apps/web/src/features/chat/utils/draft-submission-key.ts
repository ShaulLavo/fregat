import { hashKey } from '@tanstack/react-query'
import type { EnvironmentId, SessionWorktreeTarget } from '@workspace/contracts'
import type { ChatInputSubmitPayload } from './composed-message'

export function draftSubmissionKey(input: {
  agent: string | null
  payload: ChatInputSubmitPayload
  environmentId: EnvironmentId
  worktreeTarget: SessionWorktreeTarget
  fanOut: boolean
}) {
  return hashKey([input])
}
