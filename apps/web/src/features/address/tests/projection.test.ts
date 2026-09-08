import { testWorkspaceToken } from '../../../../test/factories/workspace-address'
import { describe } from 'vitest'

import { expect, test } from '../../../../test/fixtures'

import { createAddressProjection } from '@/features/address/state/projection'
import { emptyAddress, type Address } from '@workspace/client-core/address/grammar'

function harness() {
  const written: string[] = []
  const pushed: string[] = []
  let scheduled: (() => void) | null = null

  const projection = createAddressProjection({
    // A trailing debounce: scheduling again replaces the pending write rather than
    // queueing a second one, which is exactly what `frame()` below then runs.
    schedule: (write) => {
      scheduled = write

      return () => {
        scheduled = null
      }
    },
    writer: {
      push: (href) => {
        written.push(href)
        pushed.push(href)
      },
      replace: (href) => written.push(href),
    },
  })

  return {
    frame: () => {
      const write = scheduled
      scheduled = null
      write?.()
    },
    projection,
    pushed,
    written,
  }
}

function addressFor(workspace: string, document: string | null = null): Address {
  return {
    ...emptyAddress(),
    document,
    mode: 'workbench',
    workspace: testWorkspaceToken(workspace),
  }
}

describe('the address projection', () => {
  test('selecting an editor tab in chat pushes navigation history', () => {
    const { frame, projection, pushed } = harness()
    const chat: Address = {
      ...emptyAddress(),
      workspace: testWorkspaceToken('/repo'),
      mode: 'chat',
      document: 't/session-1',
      editor: 'f/a.ts',
    }
    projection.project(chat)
    frame()

    projection.project({ ...chat, editor: 'settings' })
    frame()

    expect(pushed).toEqual([`/~${testWorkspaceToken('/repo')}/chat/t/session-1?editor=settings`])
  })

  test('changing settings category replaces the current history entry', () => {
    const { frame, projection, pushed, written } = harness()
    const settings = addressFor('/repo', 'settings')
    projection.project(settings)
    frame()

    projection.project({ ...settings, settings: 'providers' })
    frame()

    expect(pushed).toEqual([])
    expect(written.at(-1)).toBe(
      `/~${testWorkspaceToken('/repo')}/workbench/settings?settings=providers`,
    )
  })

  test('coalesces a burst into one write per frame', () => {
    const { frame, projection, written } = harness()

    projection.project(addressFor('a'))
    projection.project(addressFor('b'))
    projection.project(addressFor('c'))
    expect(written).toEqual([])

    frame()
    expect(written).toEqual([`/~${testWorkspaceToken('c')}/workbench`])
  })

  test('writes nothing when the address has not changed', () => {
    const { frame, projection, written } = harness()

    projection.project(addressFor('a'))
    frame()
    projection.project(addressFor('a'))
    frame()

    expect(written).toEqual([`/~${testWorkspaceToken('a')}/workbench`])
  })

  // Safari throttles `replaceState` at ~100 calls / 30s and then THROWS. A budget
  // defended that by dropping writes, which lost the address the burst ended on; a
  // trailing debounce cannot produce the burst in the first place.
  test('collapses a long burst into a single write at the address it ended on', () => {
    const { frame, projection, written } = harness()

    for (let index = 0; index < 200; index += 1) projection.project(addressFor(`w${index}`))
    frame()

    expect(written).toEqual([`/~${testWorkspaceToken('w199')}/workbench`])
  })

  // The failure the budget had: once tripped it stayed tripped, so the last address of
  // a burst never reached either the URL or the restore payload.
  test('never drops the final address of a burst', () => {
    const { frame, projection, written } = harness()

    for (let round = 0; round < 5; round += 1) {
      for (let index = 0; index < 100; index += 1)
        projection.project(addressFor(`r${round}i${index}`))
      frame()
    }

    expect(written.at(-1)).toBe(`/~${testWorkspaceToken('r4i99')}/workbench`)
  })

  // Closing the tab does not wait out the quiet period.
  test('flushNow writes a pending address without waiting', () => {
    const { projection, written } = harness()

    projection.project(addressFor('unloading'))
    expect(written).toEqual([])

    projection.flushNow()

    expect(written).toEqual([`/~${testWorkspaceToken('unloading')}/workbench`])
  })

  test('serializes the document token into the path', () => {
    const { frame, projection, written } = harness()

    projection.project(addressFor('platform', 'f/apps/web/src/main.tsx'))
    frame()

    expect(written).toEqual([
      `/~${testWorkspaceToken('platform')}/workbench/f/apps/web/src/main.tsx`,
    ])
  })
})

describe('push versus replace, decided by slot', () => {
  test('replaces the first write — there is nothing to go back to yet', () => {
    const { frame, projection, pushed, written } = harness()

    projection.project(addressFor('a', 'f/x.ts'))
    frame()

    expect(written).toHaveLength(1)
    expect(pushed).toEqual([])
  })

  test('pushes when the document changes, so back returns to the previous one', () => {
    const { frame, projection, pushed } = harness()

    projection.project(addressFor('a', 'f/x.ts'))
    frame()
    projection.project(addressFor('a', 'f/y.ts'))
    frame()

    expect(pushed).toEqual([`/~${testWorkspaceToken('a')}/workbench/f/y.ts`])
  })

  test('pushes on a workspace change', () => {
    const { frame, projection, pushed } = harness()

    projection.project(addressFor('a', 'f/x.ts'))
    frame()
    projection.project(addressFor('b', 'f/x.ts'))
    frame()

    expect(pushed).toEqual([`/~${testWorkspaceToken('b')}/workbench/f/x.ts`])
  })

  // Six characters typed into search must not leave six history entries.
  test('replaces when only a panel or filter moves', () => {
    const { frame, projection, pushed, written } = harness()

    projection.project(addressFor('a', 'f/x.ts'))
    frame()
    projection.project({ ...addressFor('a', 'f/x.ts'), side: 'git' })
    frame()
    projection.project({ ...addressFor('a', 'f/x.ts'), search: { q: 'ab' }, side: 'git' })
    frame()

    expect(written).toHaveLength(3)
    expect(pushed).toEqual([])
  })

  // Every other case here moves FORWARD to an address never visited. A back press is
  // the opposite and looks identical from the store's side — the identity changes
  // because that is what going back means — so without `adopt` it was answered with a
  // push, and `pushState` truncates the forward entry the user just came from.
  test('replaces rather than pushes after the browser goes back', () => {
    const { frame, projection, pushed } = harness()

    projection.project(addressFor('a', 'f/x.ts'))
    frame()
    projection.project(addressFor('a', 'f/y.ts'))
    frame()
    expect(pushed).toEqual([`/~${testWorkspaceToken('a')}/workbench/f/y.ts`])

    // The browser is now showing x.ts again; the applier is about to restore it.
    projection.adopt(`/~${testWorkspaceToken('a')}/workbench/f/x.ts`)
    projection.project(addressFor('a', 'f/x.ts'))
    frame()

    expect(pushed).toEqual([`/~${testWorkspaceToken('a')}/workbench/f/y.ts`])
  })

  // An adopted address the projection itself wrote is already canonical, so restoring
  // it reproduces the same string and there is nothing to write at all.
  test('writes nothing when the restored address matches the adopted one', () => {
    const { frame, projection, written } = harness()

    projection.project(addressFor('a', 'f/x.ts'))
    frame()
    const writesBeforeBack = written.length

    projection.adopt(`/~${testWorkspaceToken('a')}/workbench/f/x.ts`)
    projection.project(addressFor('a', 'f/x.ts'))
    frame()

    expect(written).toHaveLength(writesBeforeBack)
  })

  // A panel burst must not swallow the navigation that follows it — the old budget
  // could, and then the address stayed dead for the rest of the session.
  test('still pushes a navigation that follows a long panel burst', () => {
    const { frame, projection, pushed } = harness()

    projection.project(addressFor('a', 'f/x.ts'))
    frame()
    for (let index = 0; index < 200; index += 1) {
      projection.project({ ...addressFor('a', 'f/x.ts'), side: index % 2 === 0 ? 'git' : 'files' })
    }
    frame()
    expect(pushed).toEqual([])

    projection.project(addressFor('a', 'f/navigated.ts'))
    frame()

    expect(pushed).toEqual([`/~${testWorkspaceToken('a')}/workbench/f/navigated.ts`])
  })
})
