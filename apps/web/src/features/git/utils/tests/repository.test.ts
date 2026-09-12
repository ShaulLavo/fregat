import type { GitRepositoryInfo } from '@workspace/contracts'
import { describe, expect, it } from 'vitest'

import { canSyncChanges, syncChangesLabel } from '../repository'

describe('git repository labels', () => {
  it('shows sync changes only when the working tree is clean and ahead', () => {
    expect(canSyncChanges(repositoryInfo({ ahead: 4 }), false)).toBe(true)
    expect(canSyncChanges(repositoryInfo({ ahead: 4 }), true)).toBe(false)
    expect(canSyncChanges(repositoryInfo({ ahead: 0 }), false)).toBe(false)
  })

  it('formats sync change counts with outgoing commits', () => {
    expect(syncChangesLabel(repositoryInfo({ ahead: 4 }))).toBe('Sync Changes 4↑')
    expect(syncChangesLabel(repositoryInfo({ ahead: 4, behind: 2 }))).toBe('Sync Changes 2↓ 4↑')
  })
})

function repositoryInfo(overrides: Partial<GitRepositoryInfo> = {}): GitRepositoryInfo {
  return {
    ahead: 0,
    behind: 0,
    branch: 'main',
    commit: 'abc123',
    path: 'repo',
    ...overrides,
  }
}
