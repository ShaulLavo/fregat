import type { HostResources } from '@workspace/contracts'

export function hostResources(overrides: Partial<HostResources> = {}): HostResources {
  return {
    sampledAt: 1_000,
    cpuCount: 4,
    cpuUtilization: 0.25,
    totalMemoryBytes: 16_000,
    availableMemoryBytes: 8_000,
    ...overrides,
  }
}

import { chatWorktree, fixtureEnvironmentId, TEST_ENVIRONMENT_ID, TEST_PROJECT_ID } from './chat'
import type { DraftIdentity } from '@/features/chat/utils/draft-storage'
import type { DraftMachine } from '@/features/chat/utils/draft-workspace'

export function machineDraftFixture(environmentId = TEST_ENVIRONMENT_ID) {
  const base = chatWorktree()
  const id = 'd7df5c60-5fa7-4aeb-8028-1aab248a211d'
  const target = { environmentId, draftKey: id, rootPath: base.path }
  const identity: DraftIdentity = {
    id,
    projectId: TEST_PROJECT_ID,
    rootPath: base.path,
    baseWorktreeId: base.id,
    worktreeTarget: { kind: 'current', worktreeId: base.id },
    createdAt: '2026-10-01T00:00:00.000Z',
  }
  const machines: readonly DraftMachine[] = [
    {
      environmentId,
      projectId: TEST_PROJECT_ID,
      label: 'First',
      phase: 'live',
      worktree: { id: base.id, path: base.path },
    },
    {
      environmentId: fixtureEnvironmentId(2),
      projectId: TEST_PROJECT_ID,
      label: 'Second',
      phase: 'live',
      worktree: { id: base.id, path: '/remote/repository' },
    },
  ]
  return { target, identity, machines }
}

/** The OS API can materialize CPU counters only when their fields are read. */
export function lazyCpuSamples() {
  let clock = 0
  return () => {
    clock += 100
    return [
      {
        model: 'Fixture CPU',
        speed: 1000,
        get times() {
          return { user: clock, nice: 0, sys: 0, idle: clock * 3, irq: 0 }
        },
      },
    ]
  }
}
