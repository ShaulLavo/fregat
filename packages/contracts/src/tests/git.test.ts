import { describe, expect, it } from 'vitest'
import { isBinaryGitDiff, isGitFileStatus } from '../git'

describe('isBinaryGitDiff', () => {
  it('reads a marker that starts its own line as binary', () => {
    const patch = 'diff --git a/x b/x\nindex 111..222 100644\nBinary files a/x and b/x differ\n'

    expect(isBinaryGitDiff({ patch })).toBe(true)
  })

  it('does not read a mid-line "Binary files " as binary', () => {
    const patch = 'diff --git a/x b/x\n+the string Binary files  appears here\n'

    expect(isBinaryGitDiff({ patch })).toBe(false)
  })
})

describe('isGitFileStatus', () => {
  it('accepts every known status', () => {
    for (const status of [
      'added',
      'conflicted',
      'deleted',
      'ignored',
      'modified',
      'renamed',
      'unmodified',
      'untracked',
    ]) {
      expect(isGitFileStatus(status)).toBe(true)
    }
  })

  it('rejects an unknown string', () => {
    expect(isGitFileStatus('notastatus')).toBe(false)
  })
})
