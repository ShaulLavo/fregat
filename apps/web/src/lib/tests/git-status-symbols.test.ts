import { describe, expect, it } from 'vitest'
import { gitStatusSymbol } from '@/lib/git-status-symbols'

describe('git status symbols', () => {
  it('prefixes live staged and worktree status letters', () => {
    expect(gitStatusSymbol('modified', 'staged')).toMatchObject({
      label: '+M',
      title: 'Staged modified',
    })
    expect(gitStatusSymbol('modified', 'worktree')).toMatchObject({
      label: '*M',
      title: 'Unstaged modified',
    })
  })

  it('leaves historical status letters unprefixed', () => {
    expect(gitStatusSymbol('modified', 'historical')).toMatchObject({
      label: 'M',
      title: 'Historical modified',
    })
  })
})
