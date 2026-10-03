import type { ProviderAccountUsage, ProviderUsageWindow } from '@workspace/contracts'
import { providerDriverKindSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { expect, it } from 'vitest'
import { mergeProvenUsageAccounts } from '../usage-account-merge'

it('preserves restrictions and incompatible reset epochs with unique window IDs', () => {
  const window: ProviderUsageWindow = {
    id: 'primary',
    label: 'Session',
    kind: 'session',
    usedPercent: 17,
    windowMinutes: 300,
    resetsAt: '2026-09-24T11:00:00.000Z',
    observedAt: '2026-09-24T10:00:00.000Z',
    source: 'codex-account-rate-limits',
    status: null,
  }
  const native: ProviderAccountUsage = {
    accountKey: 'native',
    driverKind: v.parse(providerDriverKindSchema, 'codex'),
    providerInstanceIds: [],
    planType: 'Plus',
    checkedAt: window.observedAt!,
    state: 'ready',
    source: 'codex-account-rate-limits',
    windows: [window],
  }
  const proxy: ProviderAccountUsage = {
    ...native,
    accountKey: 'proxy',
    source: 'cli-proxy-management',
    state: 'disabled',
    routing: { mode: 'single', active: false, lastServedAt: null },
    windows: [
      {
        ...window,
        usedPercent: 50,
        resetsAt: '2026-09-24T12:00:00.000Z',
        source: 'cliproxy-passive-cache',
      },
      { ...window, usedPercent: null, status: 'rejected', source: 'cliproxy-passive-cache' },
      { ...window, usedPercent: 90, resetsAt: null, source: 'cliproxy-passive-cache' },
      { ...window, usedPercent: 42, source: 'cliproxy-passive-cache' },
    ],
  }
  const [merged] = mergeProvenUsageAccounts(
    [native, proxy],
    new Map([
      ['native', 'same'],
      ['proxy', 'same'],
    ]),
  )
  expect(merged).toMatchObject({ state: 'disabled', routing: { active: false } })
  expect(merged!.windows).toHaveLength(5)
  expect(new Set(merged!.windows.map((entry) => entry.id)).size).toBe(5)
  expect(merged!.windows.map((entry) => entry.usedPercent)).toEqual([17, 50, null, 90, 42])
  expect(merged!.windows.map((entry) => entry.resetsAt)).toEqual([
    window.resetsAt,
    '2026-09-24T12:00:00.000Z',
    window.resetsAt,
    null,
    window.resetsAt,
  ])
  expect(merged!.windows[2]!.status).toBe('rejected')
  expect(merged!.windows.every((entry) => entry.observedAt === window.observedAt)).toBe(true)
  const readyProxy: ProviderAccountUsage = {
    ...proxy,
    accountKey: 'proxy2',
    state: 'ready',
    windows: [],
    routing: { mode: 'single', active: true, lastServedAt: null },
  }
  expect(
    mergeProvenUsageAccounts(
      [native, proxy, readyProxy],
      new Map([
        ['native', 'same'],
        ['proxy', 'same'],
        ['proxy2', 'same'],
      ]),
    )[0],
  ).toMatchObject({ state: 'disabled', routing: { active: false } })
})

it('shows observed native windows when the proven proxy row has no quota data', () => {
  const native: ProviderAccountUsage = {
    accountKey: 'native',
    driverKind: v.parse(providerDriverKindSchema, 'codex'),
    providerInstanceIds: [],
    planType: null,
    checkedAt: '2026-09-24T10:00:00.000Z',
    state: 'ready',
    source: 'codex-account-rate-limits',
    windows: [
      {
        id: 'primary',
        label: 'Session',
        kind: 'session',
        usedPercent: 17,
        windowMinutes: 300,
        resetsAt: null,
        observedAt: '2026-09-24T10:00:00.000Z',
        status: null,
      },
    ],
  }
  const proxy: ProviderAccountUsage = {
    ...native,
    accountKey: 'proxy',
    source: 'cli-proxy-management',
    state: 'no-data',
    windows: [],
  }
  expect(
    mergeProvenUsageAccounts(
      [native, proxy],
      new Map([
        ['native', 'same'],
        ['proxy', 'same'],
      ]),
    )[0],
  ).toMatchObject({ state: 'ready', windows: [expect.objectContaining({ usedPercent: 17 })] })
})
