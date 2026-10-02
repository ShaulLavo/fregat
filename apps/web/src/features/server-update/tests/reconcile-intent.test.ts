import { expect, test } from '../../../../test/fixtures'
import type { UpdateIntent } from '@/features/server-update/state/intent'
import { reconcileUpdateIntent } from '@/features/server-update/utils/reconcile-intent'
import type { ReleaseStatus } from '@/features/server-update/utils/release-ready'

const target = { release: 'release-a', stagedAt: '2026-10-02T18:00:00.000Z' }
const newer = { release: 'release-b', stagedAt: '2026-10-02T18:01:00.000Z' }
const active: readonly UpdateIntent[] = [
  { kind: 'confirm', target, busy: [] },
  { kind: 'waiting', target, busy: [], gateReadAt: 0 },
  {
    kind: 'restarting',
    target,
    startedAt: 1,
    confirmed: true,
    instance: 'old-instance',
    fromRelease: 'old-release',
  },
  { kind: 'reload', target },
  { kind: 'failed', target, reason: 'timeout' },
  { kind: 'failed', target, reason: 'health-check' },
]
const shapes = [
  {
    name: 'still staged on the old server',
    release: 'old-release',
    pending: target,
    expected: 'staged',
  },
  {
    name: 'served awaiting its health check',
    release: target.release,
    pending: null,
    expected: 'served',
  },
  { name: 'newer release staged', release: 'old-release', pending: newer, expected: 'superseded' },
  {
    name: 'another release already promoted',
    release: newer.release,
    pending: null,
    expected: 'gone',
  },
  {
    name: 'staging removed on the old server',
    release: 'old-release',
    pending: null,
    expected: 'gone',
  },
] as const

for (const intent of active) {
  for (const shape of shapes) {
    test(`${intent.kind} reconciles ${shape.name}`, () => {
      const status: ReleaseStatus = {
        release: shape.release,
        server: { release: shape.release },
        pending: shape.pending,
        liveCheck: null,
        liveCheckRequired: true,
      }
      expect(reconcileUpdateIntent(intent, status)).toBe(shape.expected)
    })
  }
}

test('idle has no update to reconcile', () => {
  expect(
    reconcileUpdateIntent(
      { kind: 'idle' },
      {
        release: 'old-release',
        server: { release: 'old-release' },
        pending: target,
        liveCheck: null,
        liveCheckRequired: true,
      },
    ),
  ).toBe('idle')
})

test('page-only intent is replaced by a new staging operation', () => {
  expect(
    reconcileUpdateIntent(
      { kind: 'reload', target: { release: target.release, stagedAt: null } },
      {
        release: target.release,
        server: { release: target.release },
        pending: newer,
        liveCheck: null,
        liveCheckRequired: true,
      },
    ),
  ).toBe('superseded')
})

for (const intent of active) {
  test(`${intent.kind} clears a staged target after a web-only release replaces it`, () => {
    expect(
      reconcileUpdateIntent(intent, {
        release: newer.release,
        server: { release: target.release },
        pending: null,
        liveCheck: null,
        liveCheckRequired: true,
      }),
    ).toBe('gone')
  })
}

test('exact staging takes precedence over independently read web and server identities', () => {
  expect(
    reconcileUpdateIntent(active[2]!, {
      release: newer.release,
      server: { release: target.release },
      pending: target,
      liveCheck: null,
      liveCheckRequired: true,
    }),
  ).toBe('staged')
})

test('unknown web identity keeps the exact served target observable', () => {
  expect(
    reconcileUpdateIntent(active[2]!, {
      release: null,
      server: { release: target.release },
      pending: null,
      liveCheck: null,
      liveCheckRequired: true,
    }),
  ).toBe('served')
})
