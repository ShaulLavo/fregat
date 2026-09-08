import { railEnvironments } from '@/features/chat-mode/state/rail-environments'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { railEnvironment as environment } from '../../../../../test/factories/chat-mode'
import {
  environmentIdSchema,
  sessionIdSchema,
  scopedSessionKey,
  scopedProjectKey,
} from '@workspace/contracts'
import * as v from 'valibot'
import { createInitialChatProjectionSlice } from '@workspace/client-core/chat/types'
import { syncChatProjectionShellSnapshot } from '@workspace/client-core/chat/writers'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import {
  chatProject,
  chatWorktree,
  sessionShell,
  shellSnapshot,
  TEST_ENVIRONMENT_ID,
  TEST_PROJECT_ID,
  TEST_SESSION_ID,
  TEST_WORKTREE_ID,
} from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
const secondEnvironmentId = v.parse(environmentIdSchema, 'e0000000-0000-4000-8000-000000000001')
const secondSessionId = v.parse(sessionIdSchema, 'f0000000-0000-4000-8000-000000000001')
const firstRef = { environmentId: TEST_ENVIRONMENT_ID, sessionId: TEST_SESSION_ID }
const secondRef = { environmentId: secondEnvironmentId, sessionId: TEST_SESSION_ID }
test('uses projected attention before cached archive, settled and snooze overlays', () => {
  const sessions = [
    sessionShell({
      attentionState: 'needs-input',
      attentionReason: 'approval',
      archivedAt: '2026-01-01T00:00:00Z',
      settledOverride: 'settled',
      snoozedUntil: '2099-01-01T00:00:00Z',
    }),
    sessionShell({ id: secondSessionId, attentionState: 'working', attentionReason: 'active' }),
  ]
  const model = sessionRailModel({ environments: [environment({}, sessions)] })
  expect(model.sections.map((section) => section.title)).toEqual([
    'Needs input',
    'Working',
    'Settled',
  ])
  expect(model.sections[0]?.groups[0]?.sessions[0]?.id).toBe(TEST_SESSION_ID)
  expect(model.sessions.map((session) => session.status)).toEqual(['needs-input', 'working'])
  expect(model.archivedCount).toBe(1)
})
test('keeps identical server UUIDs distinct while grouping the repository across machines', () => {
  const model = sessionRailModel({
    environments: [
      environment(),
      environment({ environmentId: secondEnvironmentId, label: 'Laptop', isPrimary: false }),
    ],
  })
  expect(model.sessions.map((session) => session.key)).toEqual([
    scopedSessionKey(firstRef),
    scopedSessionKey(secondRef),
  ])
  expect(model.sessions.map((session) => session.machineLabel)).toEqual(['Primary', 'Laptop'])
  expect(model.groups).toHaveLength(1)
  expect(model.sessions.every((session) => session.projectGroupKey === TEST_PROJECT_ID)).toBe(true)
  expect(model.projects).toHaveLength(1)
})
test('machine labels are omitted only for a single primary environment', () => {
  expect(sessionRailModel({ environments: [environment()] }).sessions[0]?.machineLabel).toBeNull()
  expect(
    sessionRailModel({ environments: [environment({ isPrimary: false, label: 'Laptop' })] })
      .sessions[0]?.machineLabel,
  ).toBe('Laptop')
})
test('session search matches and unread stamps cannot leak across machines', () => {
  const match = {
    sessionId: TEST_SESSION_ID,
    source: 'assistant' as const,
    snippet: 'needle',
    messageCreatedAt: '2026-05-01T00:00:00Z',
    projectId: TEST_PROJECT_ID,
    worktreeId: TEST_WORKTREE_ID,
  }
  const model = sessionRailModel({
    environments: [
      environment(),
      environment({ environmentId: secondEnvironmentId, label: 'Laptop', isPrimary: false }),
    ],
    query: 'needle',
    searchMatches: { [scopedSessionKey(secondRef)]: match },
  })
  expect(model.sessions.map((session) => session.key)).toEqual([scopedSessionKey(secondRef)])
})
test('a collapsed repository preserves only the scoped selected session', () => {
  const model = sessionRailModel({
    environments: [
      environment(),
      environment({ environmentId: secondEnvironmentId, isPrimary: false }),
    ],
    collapsedProjectIds: [TEST_PROJECT_ID],
    activeSessionKey: scopedSessionKey(secondRef),
  })
  expect(model.groups[0]?.hiddenCount).toBe(1)
  expect(model.groups[0]?.sessions.map((session) => session.key)).toEqual([
    scopedSessionKey(secondRef),
  ])
})
test('server-projected errors stay separate from the attention section', () => {
  const model = sessionRailModel({
    environments: [
      environment({}, [
        sessionShell({ attentionState: 'needs-input', attentionReason: 'failure', hasError: true }),
      ]),
    ],
  })
  expect(model.sessions[0]).toMatchObject({
    status: 'needs-input',
    hasError: true,
    attentionReason: 'failure',
  })
})
test('activity does not reorder rows within a section', () => {
  const sessions = [
    sessionShell({
      id: TEST_SESSION_ID,
      createdAt: '2026-01-01T00:00:00Z',
      latestUserMessageAt: '2026-09-01T00:00:00Z',
    }),
    sessionShell({ id: secondSessionId, createdAt: '2026-02-01T00:00:00Z' }),
  ]
  const model = sessionRailModel({ environments: [environment({}, sessions)] })
  expect(model.sessions.map((session) => session.id)).toEqual([secondSessionId, TEST_SESSION_ID])
})
test('optimistic order uses scoped keys', () => {
  const model = sessionRailModel({
    environments: [
      environment(),
      environment({ environmentId: secondEnvironmentId, isPrimary: false }),
    ],
    orderOverrides: {
      projectOrderKeys: {
        [scopedProjectKey({ environmentId: TEST_ENVIRONMENT_ID, projectId: TEST_PROJECT_ID })]:
          'a0',
      },
      sessionOrderKeys: { [scopedSessionKey(secondRef)]: 'a0' },
    },
  })
  expect(model.sessions[0]?.key).toBe(scopedSessionKey(secondRef))
  expect(model.sessions[1]?.pinOrderKey).toBeNull()
})
test('worktree owns the visible branch and open path', () => {
  const slice = syncChatProjectionShellSnapshot(
    createInitialChatProjectionSlice(),
    shellSnapshot({
      projects: [chatProject()],
      worktrees: [chatWorktree({ branch: 'feature/rail', path: '/checkout/rail' })],
    }),
  )
  const row = sessionRailModel({ environments: [environment({ slice })] }).sessions[0]
  expect(row).toMatchObject({ branch: 'feature/rail', worktreePath: '/checkout/rail' })
})

test('folds multiple endpoints for one confirmed server into one rail environment', () => {
  const slice = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), shellSnapshot())
  const folded = railEnvironments(
    { slices: { [TEST_ENVIRONMENT_ID]: slice } },
    {
      ...useEnvironmentsStore.getState(),
      entries: {
        'http://localhost:1': {
          ...createEnvironmentEntry('http://localhost:1', 'http://localhost:2'),
          origin: 'http://localhost:1',
          kind: 'origin',
          label: 'Alias',
          environmentId: TEST_ENVIRONMENT_ID,
        },
        'http://localhost:2': {
          ...createEnvironmentEntry('http://localhost:2', 'http://localhost:2'),
          origin: 'http://localhost:2',
          kind: 'primary',
          label: 'Primary',
          environmentId: TEST_ENVIRONMENT_ID,
        },
      },
    },
  )
  expect(folded).toHaveLength(1)
  expect(folded[0]).toMatchObject({
    environmentId: TEST_ENVIRONMENT_ID,
    label: 'Primary',
    isPrimary: true,
  })
  expect(sessionRailModel({ environments: folded }).sessions).toHaveLength(1)
})

test('filters one machine while retaining cached sessions from an unreachable owner', () => {
  const environments = [
    environment({ label: 'Primary' }),
    environment({
      environmentId: secondEnvironmentId,
      label: 'Laptop',
      isPrimary: false,
      phase: 'offline',
    }),
  ]
  const all = sessionRailModel({ environments })
  expect(all.groups).toHaveLength(1)
  expect(all.sessions.filter((session) => session.stale)).toHaveLength(1)
  const filtered = sessionRailModel({ environments, machineFilter: secondEnvironmentId })
  expect(filtered.sessions).toHaveLength(1)
  expect(filtered.projects[0]?.ref.environmentId).toBe(secondEnvironmentId)
  expect(filtered.sessions[0]).toMatchObject({
    environmentId: secondEnvironmentId,
    machineLabel: 'Laptop',
    stale: true,
  })
})
