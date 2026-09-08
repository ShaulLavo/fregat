import { createInitialChatProjectionSlice } from '@workspace/client-core/chat/types'
import { syncChatProjectionShellSnapshot } from '@workspace/client-core/chat/writers'
import {
  selectChatProjects,
  selectChatSessions,
  selectChatWorktrees,
} from '@workspace/client-core/chat/selectors'
import type { ChatProjectionSlice } from '@workspace/client-core/chat/types'
import type { SessionRailEnvironment } from '@workspace/client-core/chat/rail/model'
import { sessionShell, shellSnapshot, TEST_ENVIRONMENT_ID } from './chat'

export function railEnvironment(
  overrides: Partial<SessionRailEnvironment> & { slice?: ChatProjectionSlice } = {},
  sessions = [
    sessionShell({
      attentionState: 'settled',
      attentionReason: null,
      latestTurn: null,
      runtime: null,
    }),
  ],
): SessionRailEnvironment {
  const slice =
    overrides.slice ??
    syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), shellSnapshot({ sessions }))
  return {
    environmentId: TEST_ENVIRONMENT_ID,
    label: 'Primary',
    isPrimary: true,
    phase: 'live',
    projects: selectChatProjects(slice),
    worktrees: selectChatWorktrees(slice),
    sessions: selectChatSessions(slice),
    ...overrides,
  }
}
