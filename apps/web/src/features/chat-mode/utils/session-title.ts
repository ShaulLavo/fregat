import type { ProjectionSession } from '@workspace/client-core/chat/types'
import type { EnvironmentEntry } from '@workspace/client-core/environments/utils/connection'

export function sessionTitlePolicy(
  session: ProjectionSession | undefined,
  owner: EnvironmentEntry | undefined,
) {
  return {
    supported: Boolean(
      session &&
      owner?.phase === 'live' &&
      owner.descriptor?.capabilities?.sessionTitleRegeneration,
    ),
    pending: Boolean(session?.titleRegeneration),
    error: session?.titleGenerationError ?? null,
  }
}
