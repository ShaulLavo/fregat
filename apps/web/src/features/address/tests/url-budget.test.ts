import {
  testWorkspaceAddress,
  testWorkspaceToken,
} from '../../../../test/factories/workspace-address'
import { afterEach, describe, vi } from 'vitest'

import { expect, test } from '../../../../test/fixtures'

import { formatAddress } from '@workspace/client-core/address/grammar'
import { addressFromSnapshot, emptyAddressSnapshot } from '@/features/address/utils/snapshot'
import { log } from '@/lib/client-logging'

/**
 * Three slots carry whatever the user typed — or pasted: `s.q`, `s.in`/`s.x` and
 * `log.find`. Measured against the real servers, both the Vite dev server (Node) and
 * the Elysia backend (Bun) answer 431 past roughly 16KB, and that lands as a blank
 * error page on reload or on opening a shared link.
 */

const ROOT = '/repo'
const BUDGET = 4000

afterEach(() => {
  vi.restoreAllMocks()
})

function snapshotWith(extra: Partial<ReturnType<typeof emptyAddressSnapshot>>) {
  return addressFromSnapshot({
    ...emptyAddressSnapshot(),
    activeDocumentPath: `${ROOT}/src/main.ts`,
    workspaceAddress: testWorkspaceAddress(ROOT),
    mode: 'workbench' as const,
    rootPath: ROOT,
    sidebarTab: 'git' as const,
    ...extra,
  })
}

describe('the URL budget', () => {
  test('leaves an ordinary address completely alone', () => {
    const address = snapshotWith({ search: { q: 'createError' } })

    expect(address.search).toEqual({ q: 'createError' })
    expect(formatAddress(address).length).toBeLessThan(200)
  })

  // The realistic trigger is a paste, not typing: a stack trace into the search box.
  test('drops a pasted search query rather than emitting an unreachable URL', () => {
    const address = snapshotWith({ search: { q: 'x'.repeat(8000) } })

    expect(formatAddress(address).length).toBeLessThanOrEqual(BUDGET)
    expect(address.search).toBeNull()
  })

  // Identity is what makes the link worth sending at all.
  test('keeps the workspace, mode and document when it trims', () => {
    const address = snapshotWith({ search: { q: 'x'.repeat(8000) } })

    expect(address.workspace).toBe(testWorkspaceToken('/repo'))
    expect(address.mode).toBe('workbench')
    expect(address.document).toBe('f/src/main.ts')
    expect(address.side).toBe('git')
  })

  // Ascending order of how much a recipient would miss them: a query they never wrote
  // goes before their filters, which go before the tab set.
  test('drops search before logs, and logs before tabs', () => {
    const tabs = Array.from({ length: 6 }, (_, index) => `${ROOT}/src/file-${index}.ts`)
    const onlySearchTooBig = snapshotWith({
      editorTabPaths: tabs,
      logs: { level: 'error' },
      search: { q: 'x'.repeat(8000) },
    })

    expect(onlySearchTooBig.search).toBeNull()
    expect(onlySearchTooBig.logs).toEqual({ level: 'error' })
    expect(onlySearchTooBig.tabs).not.toBeNull()
  })

  test('keeps trimming when dropping the query alone is not enough', () => {
    const address = snapshotWith({
      logs: { find: 'y'.repeat(5000) },
      search: { q: 'x'.repeat(5000) },
    })

    expect(formatAddress(address).length).toBeLessThanOrEqual(BUDGET)
    expect(address.search).toBeNull()
    expect(address.logs).toBeNull()
  })

  test('debug-logs each omitted tab signature once', () => {
    const debug = vi.spyOn(log, 'debug').mockImplementation(() => {})
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const tabs = Array.from(
      { length: 17 },
      (_, index) => `${ROOT}/src/${'nested/'.repeat(12)}file-${index}.ts`,
    )

    snapshotWith({ editorTabPaths: tabs })
    snapshotWith({ editorTabPaths: tabs, sidebarTab: 'search' })
    snapshotWith({ editorTabPaths: [...tabs, `${ROOT}/src/another-file.ts`] })

    expect(debug).toHaveBeenCalledTimes(2)
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'address.tabs_omitted', area: 'address' }),
    )
    expect(warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'address.tabs_omitted' }),
    )
  })

  // A pathological path cannot be dropped — it IS the address — so the budget must not
  // loop forever or return something malformed trying.
  test('still returns a usable address when the document alone exceeds the budget', () => {
    const deep = Array.from({ length: 400 }, () => 'ünïcödé').join('/')
    const address = snapshotWith({ activeDocumentPath: `${ROOT}/${deep}.ts` })

    expect(address.workspace).toBe(testWorkspaceToken('/repo'))
    expect(address.document).toContain('f/')
    expect(address.search).toBeNull()
    expect(address.tabs).toBeNull()
  })
})
