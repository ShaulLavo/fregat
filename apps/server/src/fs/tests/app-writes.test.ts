import { describe, expect, it } from 'vitest'

import { AppWrites } from '../app-writes'

describe('AppWrites', () => {
  it('stops claiming a write once its watcher window has passed', async () => {
    let now = 0
    const writes = new AppWrites(() => now)
    await writes.record('/work/repo/foo.ts', 'version-a')

    expect(await writes.matches('/work/repo/foo.ts', 'version-a')).toBe(true)
    now = 60_000
    // An outside edit back to the app-saved content, such as `git stash pop`, reloads.
    expect(await writes.matches('/work/repo/foo.ts', 'version-a')).toBe(false)
  })
})
