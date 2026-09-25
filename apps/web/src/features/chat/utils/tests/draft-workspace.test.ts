import type { WorktreeId } from '@workspace/contracts'
import { describe, expect, test } from 'vitest'

import {
  baseBranchChoices,
  draftCanChangeMachine,
  draftWorktreeChoices,
  workspaceChoiceLabel,
} from '@/features/chat/utils/draft-workspace'
import { chatWorktree, TEST_PROJECT_ID } from '../../../../../test/factories/chat'

describe('draft workspace', () => {
  test('offers only ready linked worktrees of the project, newest first', () => {
    const worktree = (id: string, updatedAt: string, overrides = {}) =>
      chatWorktree({ id: id as WorktreeId, kind: 'linked', updatedAt, ...overrides })
    const older = worktree('00000000-0000-4000-8000-000000000001', '2026-09-01T00:00:00.000Z')
    const newer = worktree('00000000-0000-4000-8000-000000000002', '2026-09-02T00:00:00.000Z')
    const missing = worktree('00000000-0000-4000-8000-000000000003', '2026-09-03T00:00:00.000Z', {
      lifecycle: { state: 'missing' },
    })

    expect(draftWorktreeChoices([chatWorktree(), older, missing, newer], TEST_PROJECT_ID)).toEqual([
      newer,
      older,
    ])
  })

  test('base branches include app-created branches and lead with the checked-out one', () => {
    const branch = (name: string, current = false) => ({
      name,
      current,
      upstream: null,
      commit: 'a',
    })

    expect(
      baseBranchChoices([branch('dev'), branch('worktree/1234'), branch('main', true)]).map(
        (choice) => choice.name,
      ),
    ).toEqual(['main', 'dev', 'worktree/1234'])
  })

  test('the trigger label follows the target before the base', () => {
    expect(workspaceChoiceLabel({ kind: 'linked' }, { kind: 'new' }).label).toBe('New worktree')
    expect(workspaceChoiceLabel({ kind: 'linked' }, { kind: 'current' }).label).toBe('Worktree')
    expect(workspaceChoiceLabel({ kind: 'current' }, { kind: 'current' }).label).toBe(
      'Current checkout',
    )
  })

  test('a draft holding machine-local content cannot change machine', () => {
    expect(draftCanChangeMachine({ attachments: [], terminalContexts: [] })).toBe(true)
    expect(draftCanChangeMachine({ attachments: [], terminalContexts: [{} as never] })).toBe(false)
  })
})
