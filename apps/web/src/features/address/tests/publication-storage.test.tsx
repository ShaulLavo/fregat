import { afterEach, vi } from 'vitest'
import { createMemoryHistory } from '@tanstack/react-router'

import { writeAddressCache } from '@/features/address/state/storage'
import { parseAddressIntent } from '@/features/address/utils/intent'
import { createNavigation } from '@/state/navigation'
import { createApplicationRouter } from '@/state/router'
import {
  clearPendingPublication,
  rememberPendingPublication,
  takePendingPublication,
} from '@/state/navigation-publication'
import { expect, test } from '../../../../test/fixtures'

const sourceHref = '/platform/~-/workbench/s?s.q=old'
const pendingHref = '/~-/workbench/s?s.q=latest'
const identity = '3:current-entry'

afterEach(clearPendingPublication)

test('reload consumes the pending URL independently of another tab updating the global cache', () => {
  rememberPendingPublication({ identity, sourceHref, href: pendingHref })
  writeAddressCache('/~-/workbench/s?s.q=another-tab')
  expect(takePendingPublication({ identity, href: sourceHref, reload: true })).toBe(pendingHref)
  expect(takePendingPublication({ identity, href: sourceHref, reload: true })).toBeNull()
})

test('a direct visit or copied tab discards inherited pending state before any later reload', () => {
  rememberPendingPublication({ identity, sourceHref, href: pendingHref })
  expect(takePendingPublication({ identity, href: sourceHref, reload: false })).toBeNull()
  expect(takePendingPublication({ identity, href: sourceHref, reload: true })).toBeNull()
})

test('matching text in a different history entry does not resume the pending address', () => {
  rememberPendingPublication({ identity, sourceHref, href: pendingHref })
  expect(
    takePendingPublication({ identity: '4:another-entry', href: sourceHref, reload: true }),
  ).toBeNull()
})

test('a different explicit URL in the same history entry wins over retained publication', () => {
  rememberPendingPublication({ identity, sourceHref, href: pendingHref })
  expect(
    takePendingPublication({ identity, href: '/platform/~-/workbench/settings', reload: true }),
  ).toBeNull()
})

for (const raw of [
  '{',
  'null',
  '{}',
  '{"identity":1}',
  JSON.stringify({ identity, sourceHref, href: '//other.test/' }),
]) {
  test(`malformed pending state is discarded: ${raw}`, () => {
    sessionStorage.setItem('platform.navigation.pending', raw)
    expect(takePendingPublication({ identity, href: sourceHref, reload: true })).toBeNull()
    expect(sessionStorage.getItem('platform.navigation.pending')).toBeNull()
  })
}

test('a settled or canceled publication leaves nothing for reload to restore', () => {
  rememberPendingPublication({ identity, sourceHref, href: pendingHref })
  clearPendingPublication()
  expect(takePendingPublication({ identity, href: sourceHref, reload: true })).toBeNull()
})

test('reload preparation exposes the retained intent to application bootstrap', () => {
  const history = createMemoryHistory({ initialEntries: [sourceHref] })
  const state = history.location.state
  rememberPendingPublication({
    identity: `${state.__TSR_index}:${state.__TSR_key ?? ''}`,
    sourceHref,
    href: pendingHref,
  })
  const entry = {
    name: sourceHref,
    entryType: 'navigation',
    startTime: 0,
    duration: 0,
    type: 'reload',
    toJSON: () => ({}),
  }
  const entries = vi.spyOn(performance, 'getEntriesByType').mockReturnValue([entry])
  try {
    const router = createApplicationRouter({ history, basepath: '/platform/' })
    const navigation = createNavigation(router, parseAddressIntent('/~-/workbench/s?s.q=old'))
    expect(navigation.initial.address.search?.q).toBe('latest')
    navigation.dispose()
  } finally {
    entries.mockRestore()
  }
})
