import type { ProviderInstanceId, ProviderUpdateAdvisory } from '@workspace/contracts'

import { updateLine } from '@/features/settings/utils/provider-update-line'
import { expect, test } from '../../../../test/fixtures'

function advisory(overrides: Partial<ProviderUpdateAdvisory>): ProviderUpdateAdvisory {
  return {
    canUpdate: false,
    checkedAt: '2026-09-25T00:00:00.000Z',
    command: null,
    installedVersion: '2.1.0',
    latestVersion: '2.2.0',
    method: 'unknown',
    providerInstanceId: 'claude' as ProviderInstanceId,
    status: 'behind',
    ...overrides,
  }
}

test('a current CLI shows its version and nothing to do', () => {
  expect(updateLine(advisory({ latestVersion: '2.1.0', status: 'current' }))).toMatchObject({
    action: null,
    note: 'Up to date',
    versions: '2.1.0',
  })
})

test('a CLI behind the release offers the one-click update or the command to run', () => {
  expect(
    updateLine(advisory({ canUpdate: true, command: 'claude update', method: 'native' })),
  ).toMatchObject({ action: 'update', command: null, versions: '2.1.0 → 2.2.0' })
  expect(updateLine(advisory({ command: 'mise upgrade claude', method: 'mise' }))).toMatchObject({
    action: 'copy',
    command: 'mise upgrade claude',
  })
  expect(updateLine(advisory({ method: 'bundled' }))).toMatchObject({
    action: null,
    note: 'Updates with the app',
  })
})

test('an unreadable version says so', () => {
  expect(
    updateLine(advisory({ installedVersion: null, latestVersion: null, status: 'unknown' })),
  ).toMatchObject({ action: null, note: 'Version unknown', versions: null })
})
