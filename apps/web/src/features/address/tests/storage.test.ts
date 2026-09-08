import { testWorkspaceToken } from '../../../../test/factories/workspace-address'
import { describe, afterEach, beforeEach } from 'vitest'

import { expect, test } from '../../../../test/fixtures'

import { parseAddress } from '@workspace/client-core/address/grammar'
import {
  readAddressCache,
  restoreAddressFromStorage,
  writeAddressCache,
} from '@/features/address/state/storage'

/**
 * The localStorage half of the dual serialization, which had no tests — and that is how
 * a re-encoding bug reached the running app: `writeAddressCache` stripped dev params
 * through `url.searchParams.delete`, and merely touching `searchParams` re-serializes
 * the whole query, re-escaping the `/` and `~` that `?tabs=` leaves bare.
 */

const TABS = `/~${testWorkspaceToken('/repo')}/workbench/f/src/a.ts?tabs=f/src/a.ts~f/src/b.ts&side=git`

// The `node` project has no `localStorage`; this mirrors the shim `workspace-cache.test.ts`
// already installs rather than growing a second way to do the same thing.
const STORE = new Map<string, string>()

describe('writeAddressCache', () => {
  beforeEach(() => {
    STORE.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => STORE.get(key) ?? null,
        key: (index: number) => Array.from(STORE.keys())[index] ?? null,
        get length() {
          return STORE.size
        },
        removeItem: (key: string) => {
          STORE.delete(key)
        },
        setItem: (key: string, value: string) => {
          STORE.set(key, value)
        },
      },
    })
  })

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage
  })

  // The regression: what is stored has to be what the parser reads back.
  test('stores the address in the shape the parser reads', () => {
    writeAddressCache(TABS)

    expect(readAddressCache()).toBe(TABS)
    expect(parseAddress(readAddressCache() ?? '').tabs).toEqual(['f/src/a.ts', 'f/src/b.ts'])
  })

  test('does not re-escape the bare slashes and separators in `?tabs=`', () => {
    writeAddressCache(TABS)

    expect(readAddressCache()).not.toContain('%2F')
    expect(readAddressCache()).not.toContain('%7E')
  })

  // A dev param is opt-in for the session someone typed it into, never for the machine.
  test('strips dev params without disturbing the rest', () => {
    writeAddressCache(`${TABS}&decode=diffusion&editorPerfTrace=1`)

    const stored = readAddressCache() ?? ''
    expect(stored).not.toContain('decode=')
    expect(stored).not.toContain('editorPerfTrace')
    expect(parseAddress(stored).tabs).toEqual(['f/src/a.ts', 'f/src/b.ts'])
    expect(parseAddress(stored).side).toBe('git')
  })

  test('leaves an address with no query alone', () => {
    writeAddressCache(`/~${testWorkspaceToken('/repo')}/workbench/f/src/a.ts`)

    expect(readAddressCache()).toBe(`/~${testWorkspaceToken('/repo')}/workbench/f/src/a.ts`)
  })

  test('keeps the fragment, which names the position', () => {
    writeAddressCache(
      `/~${testWorkspaceToken('/repo')}/workbench/f/src/a.ts?decode=diffusion#L21,9`,
    )

    expect(readAddressCache()).toBe(`/~${testWorkspaceToken('/repo')}/workbench/f/src/a.ts#L21,9`)
  })
})

/**
 * The read half, which had no tests at all — and so carried the same re-encoding bug
 * one release longer than the write half. `mergeLiveSearch` reached for
 * `url.searchParams.set`, and merely touching `searchParams` re-serializes the whole
 * query, turning `?tabs=f/src/a.ts~f/src/b.ts` into one token the parser rejects.
 */
describe('restoreAddressFromStorage', () => {
  beforeEach(() => {
    STORE.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => STORE.get(key) ?? null,
        key: (index: number) => Array.from(STORE.keys())[index] ?? null,
        get length() {
          return STORE.size
        },
        removeItem: (key: string) => {
          STORE.delete(key)
        },
        setItem: (key: string, value: string) => {
          STORE.set(key, value)
        },
      },
    })
  })

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage
  })

  test('installs the stored address when the launch URL is bare', () => {
    writeAddressCache(TABS)

    expect(restoreAt('/', '')).toBe(TABS)
  })

  // The regression: a cold launch carrying a dev param must not re-encode the rest.
  test('merges live dev params without re-escaping `?tabs=`', () => {
    writeAddressCache(TABS)

    const href = restoreAt('/', '?decode=diffusion') ?? ''

    expect(href).not.toContain('%2F')
    expect(href).not.toContain('%7E')
    expect(parseAddress(href).tabs).toEqual(['f/src/a.ts', 'f/src/b.ts'])
    expect(parseAddress(href).passthrough).toEqual({ decode: 'diffusion' })
    expect(parseAddress(href).side).toBe('git')
  })

  test('lets a live param override the stored one of the same name', () => {
    writeAddressCache(`${TABS}&decode=stored`)

    const href = restoreAt('/', '?decode=live') ?? ''

    expect(parseAddress(href).passthrough).toEqual({ decode: 'live' })
    expect(parseAddress(href).tabs).toEqual(['f/src/a.ts', 'f/src/b.ts'])
  })

  // A pasted link must never be overwritten by what this machine was doing last.
  test('leaves a URL that already names a place alone', () => {
    writeAddressCache(TABS)

    expect(restoreAt(`/~${testWorkspaceToken('other')}/workbench/f/z.ts`, '')).toBeNull()
  })
})

/**
 * `restoreAddressFromStorage` reads `location` and writes through the `History` it is
 * given; only the history seam is injectable, so the location is stubbed around it.
 */
function restoreAt(pathname: string, search: string) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { pathname, search },
  })

  try {
    return restoreAddressFromStorage({ replaceState: () => {} } as unknown as History)
  } finally {
    if (original) Object.defineProperty(globalThis, 'location', original)
    else delete (globalThis as { location?: Location }).location
  }
}
