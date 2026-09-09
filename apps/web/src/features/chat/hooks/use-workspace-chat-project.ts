import type {
  OrchestrationProjectShell,
  OrchestrationWorktreeShell,
  ProjectRegistrationResult,
} from '@workspace/contracts'
import { useEffect, useRef, useState } from 'react'

import { errorMessage } from '@/lib/error-message'
import { projectRegistrationResult } from '@workspace/client-core/chat/registration'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { createWorkspaceProjectCommand } from '@workspace/client-core/chat/commands'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { selectWorktreeAtPath } from '@workspace/client-core/chat/selectors'

type Registration = {
  rootPath: string
  transport: ChatTransport
  result: ProjectRegistrationResult
}
type Failure = { rootPath: string; transport: ChatTransport; message: string }
export type WorkspaceChatProjectState = {
  error: string | null
  project: OrchestrationProjectShell | null
  worktree: OrchestrationWorktreeShell | null
  status: 'ready' | 'waiting'
}

export function useWorkspaceChatProject({
  transport,
  rootPath,
}: {
  transport: ChatTransport
  rootPath: string
}): WorkspaceChatProjectState {
  const slice = useChatProjectionStore((state) =>
    selectChatProjectionSlice(state, transport.environmentId),
  )
  const [registration, setRegistration] = useState<Registration | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const dispatched = useRef<{ rootPath: string; transport: ChatTransport } | null>(null)
  const receipt =
    registration?.rootPath === rootPath && registration.transport === transport
      ? registration.result
      : null
  const worktree =
    (receipt ? slice.worktreeById[receipt.worktreeId] : selectWorktreeAtPath(slice, rootPath)) ??
    null
  const project = worktree ? (slice.projectById[worktree.projectId] ?? null) : null

  useEffect(() => {
    if (!slice.bootstrapComplete || worktree) return
    if (dispatched.current?.rootPath === rootPath && dispatched.current.transport === transport)
      return
    dispatched.current = { rootPath, transport }
    void registerProject({ transport, rootPath, setRegistration, setFailure })
  }, [slice.bootstrapComplete, worktree, rootPath, transport])

  return {
    error:
      failure?.rootPath === rootPath && failure.transport === transport ? failure.message : null,
    project,
    worktree,
    status: project && worktree ? 'ready' : 'waiting',
  }
}

async function registerProject({
  transport,
  rootPath,
  setRegistration,
  setFailure,
}: {
  transport: ChatTransport
  rootPath: string
  setRegistration: (registration: Registration) => void
  setFailure: (failure: Failure) => void
}) {
  try {
    const receipt = await transport.dispatchCommand(createWorkspaceProjectCommand({ rootPath }))
    if (transport.closed) return
    setRegistration({ rootPath, transport, result: projectRegistrationResult(receipt) })
  } catch (error) {
    if (transport.closed) return
    setFailure({
      rootPath,
      transport,
      message: errorMessage(error, 'Could not prepare chat for this workspace.'),
    })
  }
}
