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
test.each(['approval', 'user-input', 'plan', 'failure', 'interruption'] as const)(
  'archive excludes %s attention from active results and retains it in archive',
  (attentionReason) => {
    const sessions = [
      sessionShell({
        attentionState: 'needs-input',
        attentionReason,
        runtime: null,
        pendingApprovalCount: attentionReason === 'approval' ? 1 : 0,
        pendingUserInputCount: attentionReason === 'user-input' ? 1 : 0,
        archivedAt: '2026-01-01T00:00:00Z',
        title: 'Archived attention',
      }),
      sessionShell({ id: secondSessionId, attentionState: 'working', attentionReason: 'active' }),
    ]
    const environments = [environment({}, sessions)]
    expect(sessionRailModel({ environments }).sessions.map((session) => session.id)).toEqual([
      secondSessionId,
    ])
    expect(sessionRailModel({ environments, query: 'Archived attention' }).sessions).toEqual([])
    const archived = sessionRailModel({ environments, view: 'archived' })
    expect(archived.sessions.map((session) => session.id)).toEqual([TEST_SESSION_ID])
    expect(archived.sessions[0]?.status).toBe(
      {
        approval: 'approval',
        'user-input': 'input',
        plan: 'ready',
        failure: 'ready',
        interruption: 'ready',
      }[attentionReason],
    )
    expect(archived.archivedCount).toBe(1)
  },
)
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
  expect(
    model.sessions.every(
      (session) => session.projectGroupKey === 'repository:git-remote:github.com/example/platform',
    ),
  ).toBe(true)
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
    collapsedProjectIds: [TEST_ENVIRONMENT_ID, secondEnvironmentId].map((environmentId) =>
      scopedProjectKey({ environmentId, projectId: TEST_PROJECT_ID }),
    ),
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
        sessionShell({
          attentionState: 'needs-input',
          attentionReason: 'failure',
          hasError: true,
          runtime: null,
        }),
      ]),
    ],
  })
  expect(model.sessions[0]).toMatchObject({
    status: 'ready',
    placement: 'active',
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
      environment({}, [sessionShell({ pinnedAt: '2026-01-01T00:00:00Z' })]),
      environment({ environmentId: secondEnvironmentId, isPrimary: false }, [
        sessionShell({ pinnedAt: '2026-01-01T00:00:00Z' }),
      ]),
    ],
    orderOverrides: {
      projectOrderKeys: {
        [scopedProjectKey({ environmentId: TEST_ENVIRONMENT_ID, projectId: TEST_PROJECT_ID })]:
          'a0',
      },
      sessionLifecycleByKey: { [scopedSessionKey(secondRef)]: { pinOrderKey: 'a0' } },
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

test('grouping settings retain scoped owners and choose primary independently of iteration order', () => {
  const environments = [
    environment({ environmentId: secondEnvironmentId, isPrimary: false }),
    environment(),
  ]
  for (const mode of ['repository', 'repository_path'] as const) {
    const model = sessionRailModel({ environments, grouping: { mode, overrides: {} } })
    expect(model.projects).toHaveLength(1)
    expect(model.projects[0]?.ref.environmentId).toBe(TEST_ENVIRONMENT_ID)
    expect(model.projects[0]?.members).toHaveLength(2)
    expect(model.projects[0]?.sessionRefs).toHaveLength(2)
  }
  expect(
    sessionRailModel({ environments, grouping: { mode: 'separate', overrides: {} } }).projects,
  ).toHaveLength(2)
  const remoteKey = scopedProjectKey({
    environmentId: secondEnvironmentId,
    projectId: TEST_PROJECT_ID,
  })
  expect(
    sessionRailModel({
      environments,
      grouping: { mode: 'repository', overrides: { [remoteKey]: 'separate' } },
    }).projects,
  ).toHaveLength(2)
  const filtered = sessionRailModel({ environments, machineFilter: secondEnvironmentId })
  expect(filtered.projects[0]?.members.map((member) => member.ref.environmentId)).toEqual([
    secondEnvironmentId,
  ])
  expect(filtered.projects[0]?.sessionRefs).toEqual([secondRef])
})

test('directory identities stay physical and disconnected owners remain in the action scope', () => {
  const primary = environment()
  const remote = environment({
    environmentId: secondEnvironmentId,
    isPrimary: false,
    phase: 'reconnecting',
  })
  const grouped = sessionRailModel({ environments: [primary, remote] })
  expect(grouped.projects[0]?.members.map((member) => member.available)).toEqual([true, false])
  const directory = chatProject({
    repositoryKind: 'directory',
    repositoryIdentity: { source: 'path', canonical: '/same/path' },
  })
  expect(
    sessionRailModel({
      environments: [
        { ...primary, projects: [directory] },
        { ...remote, projects: [directory] },
      ],
    }).projects,
  ).toHaveLength(2)
})

test('text filtering narrows action members and session refs', () => {
  const environments = [
    environment({}, [sessionShell({ title: 'Local unique' })]),
    environment({ environmentId: secondEnvironmentId, isPrimary: false }, [
      sessionShell({ title: 'Remote unique' }),
    ]),
  ]
  const project = sessionRailModel({ environments, query: 'Remote unique' }).groups[0]!.project
  expect(project.members.map((member) => member.ref.environmentId)).toEqual([secondEnvironmentId])
  expect(project.sessionRefs).toEqual([secondRef])
})

test('separate grouping marks only the active scoped owner', () => {
  const model = sessionRailModel({
    environments: [
      environment(),
      environment({ environmentId: secondEnvironmentId, isPrimary: false }),
    ],
    grouping: { mode: 'separate', overrides: {} },
    activeProjectRef: { environmentId: secondEnvironmentId, projectId: TEST_PROJECT_ID },
  })
  expect(
    model.projects.filter((project) => project.active).map((project) => project.ref.environmentId),
  ).toEqual([secondEnvironmentId])
})
