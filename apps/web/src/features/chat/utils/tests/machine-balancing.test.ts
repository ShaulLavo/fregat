import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { test, expect } from '../../../../../test/fixtures'
import { hostResources } from '../../../../../test/factories/host-resources'
import { fixtureEnvironmentId } from '../../../../../test/factories/chat'
import { chooseDraftMachine, machinePreferenceWeight } from '../machine-balancing'

test('balancing defaults to off with normal preferences', () => {
  expect(DEFAULT_SETTING_VALUES['environments.loadBalancing']).toBe(false)
  expect(machinePreferenceWeight()).toBe(50)
})

test.each([
  ['prefer', 100],
  ['normal', 50],
  ['less-often', 25],
  ['manual-only', 0],
] as const)('%s has weight %s', (preference, weight) => {
  expect(machinePreferenceWeight(preference)).toBe(weight)
})

test('capacity selects by environment identity and weights available resources', () => {
  const first = {
    environmentId: fixtureEnvironmentId(1),
    resources: hostResources(),
    receivedAt: 1_000,
  }
  const second = {
    environmentId: fixtureEnvironmentId(2),
    resources: hostResources({ cpuCount: 8 }),
    receivedAt: 1_000,
  }
  expect(chooseDraftMachine([first, second], 1_000)).toBe(second.environmentId)
  expect(
    chooseDraftMachine(
      [
        { ...first, preference: 'prefer' },
        { ...second, preference: 'less-often' },
      ],
      1_000,
    ),
  ).toBe(first.environmentId)
  expect(
    chooseDraftMachine(
      [
        { ...first, preference: 'manual-only' },
        { ...second, preference: 'manual-only' },
      ],
      1_000,
    ),
  ).toBeNull()
})

test.each([{ cpuUtilization: null }, { cpuUtilization: 0.95 }, { availableMemoryBytes: 800 }])(
  'unavailable capacity asks for a choice',
  (resources) => {
    expect(
      chooseDraftMachine(
        [
          {
            environmentId: fixtureEnvironmentId(1),
            resources: hostResources(resources),
            receivedAt: 1_000,
          },
        ],
        1_000,
      ),
    ).toBeNull()
  },
)

test('stale and future receipt times are excluded independently of server clocks', () => {
  const candidate = {
    environmentId: fixtureEnvironmentId(1),
    resources: hostResources({ sampledAt: 999_999_999 }),
    receivedAt: 1_000,
  }
  expect(chooseDraftMachine([candidate], 1_000)).toBe(candidate.environmentId)
  expect(chooseDraftMachine([candidate], 16_001)).toBeNull()
  expect(chooseDraftMachine([candidate], -4_001)).toBeNull()
  expect(chooseDraftMachine([{ ...candidate, resources: null }], 1_000)).toBeNull()
})
