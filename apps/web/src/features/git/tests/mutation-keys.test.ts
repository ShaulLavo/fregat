import { describe, expect, it } from 'vitest'

import { gitMutationScope, mutationKeys } from '@/features/git/utils/mutation-keys'

describe('mutationKeys', () => {
  it('uses stable keys for repository-wide git mutations', () => {
    expect(mutationKeys.commit('repo')).toEqual(['git', 'mutation', 'repo', 'commit'])
    expect(mutationKeys.checkout('repo')).toEqual(['git', 'mutation', 'repo', 'checkout'])
    expect(mutationKeys.sync('repo')).toEqual(['git', 'mutation', 'repo', 'sync'])
  })

  it('keeps bulk path order in multi-path mutation keys', () => {
    expect(mutationKeys.stageMany('repo', ['b.ts', 'a.ts'])).toEqual([
      'git',
      'mutation',
      'repo',
      'stage-many',
      'b.ts',
      'a.ts',
    ])
    expect(mutationKeys.discardStagedMany('repo', ['one', 'two'])).toEqual([
      'git',
      'mutation',
      'repo',
      'discard-staged-many',
      'one',
      'two',
    ])
  })

  it('scopes every mutation under its repository root', () => {
    const scope = gitMutationScope('repo')
    for (const key of [
      mutationKeys.createPullRequest('repo'),
      mutationKeys.push('repo'),
      mutationKeys.stage('repo', 'a.ts'),
      mutationKeys.unstageMany('repo', ['a.ts']),
    ]) {
      expect(key.slice(0, scope.length)).toEqual([...scope])
    }
    expect(mutationKeys.push('repo/.worktrees/one').slice(0, scope.length)).not.toEqual([...scope])
  })
})
