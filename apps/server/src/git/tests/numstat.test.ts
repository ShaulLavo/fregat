import { describe, expect, it } from 'vitest'

import { parseNumstat } from '../numstat'

describe('parseNumstat', () => {
  it('reads plain, renamed and binary records from -z output', () => {
    const output = ['3\t1\tsrc/a.ts', '2\t0\t', 'old/b.ts', 'new/b.ts', '-\t-\tlogo.png', ''].join(
      '\0',
    )

    expect([...parseNumstat(output, 'repo')]).toEqual([
      ['repo/src/a.ts', { additions: 3, deletions: 1 }],
      ['repo/new/b.ts', { additions: 2, deletions: 0 }],
    ])
  })
})
