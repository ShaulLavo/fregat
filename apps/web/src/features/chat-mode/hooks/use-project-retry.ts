import { useState } from 'react'

import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { createWorkspaceProjectCommand } from '@workspace/client-core/chat/commands'
import { log } from '@/lib/client-logging'
import { errorMessage } from '@/lib/error-message'

type ProjectRetryAttempt = {
  readonly error: string | null
  readonly retrying: boolean
}

const IDLE: ProjectRetryAttempt = { error: null, retrying: false }

/**
 * A second chance at preparing chat for this workspace. The first attempt happens once
 * per project id and never repeats itself, which is correct for an automatic retry and
 * useless to a user staring at a workspace that failed to open — the only thing that
 * ever fixes a first run is asking again.
 */
export function useProjectRetry({
  transport,
  rootPath,
}: {
  readonly transport: ChatTransport
  readonly rootPath: string
}) {
  const [attempt, setAttempt] = useState<ProjectRetryAttempt>(IDLE)

  function retryProject() {
    if (attempt.retrying) return

    setAttempt({ error: null, retrying: true })
    void requestWorkspaceProject({ transport, rootPath, setAttempt })
  }

  return { error: attempt.error, retrying: attempt.retrying, retryProject }
}

async function requestWorkspaceProject({
  transport,
  rootPath,
  setAttempt,
}: {
  transport: ChatTransport
  rootPath: string
  setAttempt: (attempt: ProjectRetryAttempt) => void
}) {
  try {
    const result = await transport.dispatchCommand(createWorkspaceProjectCommand({ rootPath }))
    setAttempt(IDLE)
    log.info({
      action: 'chat.project.retry',
      area: 'chat',
      commandType: 'project.create',
      deduped: result.deduped,
      outcome: 'ok',
      rootPath,
      sequence: result.sequence,
    })
  } catch (error) {
    const reason = errorMessage(error, 'Could not prepare chat for this workspace.')
    setAttempt({ error: reason, retrying: false })
    log.warn({
      action: 'chat.project.retry',
      area: 'chat',
      commandType: 'project.create',
      outcome: 'error',
      reason,
      rootPath,
    })
  }
}
