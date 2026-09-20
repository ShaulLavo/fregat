import {
  useChatProjectionStore,
  type ChatProjectionState,
} from '@/features/chat/state/chat-projection-store'
import { type EnvironmentsState } from '@workspace/client-core/environments/state/store'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import type { SessionRailEnvironment } from '@workspace/client-core/chat/rail/model'
import {
  selectChatProjects,
  selectChatSessions,
  selectChatWorktrees,
} from '@workspace/client-core/chat/selectors'

export function railEnvironments(
  projection: ChatProjectionState,
  environments: Pick<EnvironmentsState, 'entries'>,
): readonly SessionRailEnvironment[] {
  const byIdentity = new Map<SessionRailEnvironment['environmentId'], SessionRailEnvironment>()
  for (const entry of Object.values(environments.entries)) {
    if (!entry.environmentId) continue
    const slice = projection.slices[entry.environmentId]
    if (!slice) continue
    if (byIdentity.has(entry.environmentId) && entry.kind !== 'primary') continue
    byIdentity.set(entry.environmentId, {
      environmentId: entry.environmentId,
      label: entry.label ?? entry.name,
      isPrimary: entry.kind === 'primary',
      phase: entry.phase,
      capabilities: entry.descriptor?.capabilities,
      projects: selectChatProjects(slice),
      worktrees: selectChatWorktrees(slice),
      sessions: selectChatSessions(slice),
    })
  }
  return [...byIdentity.values()]
}

export function createRailEnvironmentsSelector(entries: EnvironmentsState['entries']) {
  let previous: readonly SessionRailEnvironment[] = []
  return (projection: ChatProjectionState) => {
    const next = railEnvironments(projection, { entries }).map((environment) => {
      const held = previous.find((entry) => entry.environmentId === environment.environmentId)
      if (
        held?.phase === environment.phase &&
        held.capabilities === environment.capabilities &&
        held.label === environment.label &&
        held.projects === environment.projects &&
        held.worktrees === environment.worktrees &&
        held.sessions === environment.sessions
      )
        return held
      return environment
    })
    if (next.length === previous.length && next.every((entry, index) => entry === previous[index]))
      return previous
    previous = next
    return next
  }
}
export function currentRailEnvironments() {
  return railEnvironments(useChatProjectionStore.getState(), useEnvironmentsStore.getState())
}
