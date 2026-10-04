import type { ProviderAccountUsage, ProviderUsageWindow } from '@workspace/contracts'
import { providerDriverKindSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { expect, it } from 'vitest'
import { mergeProvenUsageAccounts } from '../usage-account-merge'

it('preserves restrictions and one account allowance across newer reset observations', () => {
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
        resetsAt: '2026-09-24T10:59:59.000Z',
        observedAt: '2026-09-24T10:10:00.000Z',
        source: 'cliproxy-passive-cache',
      },
      { ...window, id: 'bengalfox:primary', usedPercent: 9, source: 'cliproxy-passive-cache' },
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
  expect(merged!.windows).toMatchObject([
    {
      id: 'primary',
      usedPercent: 50,
      resetsAt: '2026-09-24T10:59:59.000Z',
      observedAt: '2026-09-24T10:10:00.000Z',
    },
    { id: 'bengalfox:primary', usedPercent: 9, observedAt: window.observedAt },
  ])
  const reversed = mergeProvenUsageAccounts(
    [proxy, native],
    new Map([
      ['native', 'same'],
      ['proxy', 'same'],
    ]),
  )
  expect(reversed[0]!.windows).toEqual(merged!.windows)
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
