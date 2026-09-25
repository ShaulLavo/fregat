import { describe, expect, test } from 'vitest'

import { draftMachines } from '@/features/chat-mode/utils/draft-machines'
import { railEnvironment } from '../../../../../test/factories/chat-mode'
import {
  chatWorktree,
  fixtureEnvironmentId,
  TEST_ENVIRONMENT_ID,
  TEST_PROJECT_ID,
} from '../../../../../test/factories/chat'

const settings = { mode: 'repository', overrides: {} } as const
const ref = { environmentId: TEST_ENVIRONMENT_ID, projectId: TEST_PROJECT_ID }

describe('draft machines', () => {
  test('lists every machine with the same repository, with its main checkout when ready', () => {
    const primary = railEnvironment()
    const remote = railEnvironment({
      environmentId: fixtureEnvironmentId(2),
      label: 'mac',
      isPrimary: false,
      phase: 'offline',
      worktrees: [chatWorktree({ path: '/Users/me/platform', lifecycle: { state: 'missing' } })],
    })

    expect(draftMachines([primary, remote], settings, ref)).toEqual([
      {
        environmentId: TEST_ENVIRONMENT_ID,
        projectId: TEST_PROJECT_ID,
        label: 'Primary',
        phase: 'live',
        worktree: { id: primary.worktrees[0]!.id, path: primary.worktrees[0]!.path },
      },
      {
        environmentId: fixtureEnvironmentId(2),
        projectId: TEST_PROJECT_ID,
        label: 'mac',
        phase: 'offline',
        worktree: null,
      },
    ])
  })

  test('a project kept separate per machine offers no other machine', () => {
    const remote = railEnvironment({ environmentId: fixtureEnvironmentId(2), isPrimary: false })

    expect(
      draftMachines([railEnvironment(), remote], { mode: 'separate', overrides: {} }, ref),
    ).toHaveLength(1)
  })
})
