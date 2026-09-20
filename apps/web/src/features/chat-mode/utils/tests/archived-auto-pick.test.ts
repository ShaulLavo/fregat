import { TEST_ENVIRONMENT_ID, chatWorktree } from '../../../../../test/factories/chat'
import { projectIdSchema, sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import { selectChatSidebarSessionsForProject } from '@workspace/client-core/chat/selectors'
import { createInitialChatProjectionSlice } from '@workspace/client-core/chat/types'
import { syncChatProjectionShellSnapshot } from '@workspace/client-core/chat/writers'
import { activeSession } from '@/features/chat-mode/utils/active-session'
import { comparePinnedSessions } from '@workspace/client-core/chat/rail/session-order'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import { chatProject, sessionShell } from '../../../../../test/factories/chat'
import { railEnvironment } from '../../../../../test/factories/chat-mode'
import { expect, test } from '../../../../../test/fixtures'

const projectId = v.parse(projectIdSchema, 'fcad4a69-3e68-5de2-8303-a2c1ebe8f60c')
const archivedId = v.parse(sessionIdSchema, 'bddfb36f-ebed-581b-aec7-4e191ed2a817')
const liveId = v.parse(sessionIdSchema, '1cb66ded-870c-5359-8e74-f911ce864e73')

test('the stage never opens a session the rail refuses to draw', () => {
  const state = projection()
  const stageSessionIds = selectChatSidebarSessionsForProject(state, projectId)
    .toSorted(comparePinnedSessions)
    .map((session) => session.id)
  const rail = sessionRailModel({
    activeProjectRef: { environmentId: TEST_ENVIRONMENT_ID, projectId },
    environments: [
      railEnvironment({
        environmentId: TEST_ENVIRONMENT_ID,
        label: null,
        isPrimary: true,
        slice: state,
      }),
    ],
  })

  // The newest session is archived: auto-picking it would strand the stage on a
  // conversation with no row to select or leave.
  expect(stageSessionIds).toEqual(rail.sessions.map((session) => session.id))
  expect(
    activeSession({
      environmentId: TEST_ENVIRONMENT_ID,
      projectId,
      selection: { kind: 'auto' },
      sessionIds: stageSessionIds,
    }),
  ).toEqual({ status: 'auto', sessionId: liveId })
})

test('an archived session the user picked still reaches the stage', () => {
  expect(
    activeSession({
      environmentId: TEST_ENVIRONMENT_ID,
      archivedSessionIds: [archivedId],
      projectId,
      selection: {
        kind: 'session',
        environmentId: TEST_ENVIRONMENT_ID,
        projectId,
        sessionId: archivedId,
      },
      sessionIds: [liveId],
    }),
  ).toEqual({ status: 'ready', sessionId: archivedId })
})

function projection() {
  return syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), {
    projects: [chatProject({ id: projectId })],
    worktrees: [chatWorktree({ projectId })],
    snapshotSequence: 1,
    sessions: [
      sessionShell({
        archivedAt: '2026-05-10T00:00:00.000Z',
        id: archivedId,
        createdAt: '2026-05-09T00:00:00.000Z',
        attentionState: 'settled',
        attentionReason: null,
        title: 'Archived newest',
      }),
      sessionShell({
        id: liveId,
        createdAt: '2026-05-01T00:00:00.000Z',
        attentionState: 'settled',
        attentionReason: null,
        title: 'Still listed',
      }),
    ],
    updatedAt: '2026-05-10T00:00:00.000Z',
  })
}
