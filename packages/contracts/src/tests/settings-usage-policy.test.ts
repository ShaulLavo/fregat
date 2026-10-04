import { presentSetting } from '../settings/documentation'
import { expect, test } from 'vitest'
import * as v from 'valibot'
import { SETTINGS_JSON_SCHEMA } from '../settings/schema'

const ID = 'providers.proxyUsageRequestIntervalHours'

test('parked Codex usage has a machine-only full quota interval with an hourly minimum', () => {
  const descriptor = presentSetting(ID)
  expect(descriptor.scope).toBe('machine')
  expect(descriptor.default).toBe(1)
  expect(descriptor.description).toContain('parked Codex accounts')
  expect(SETTINGS_JSON_SCHEMA.properties[ID]).toMatchObject({
    type: 'integer',
    minimum: 1,
    maximum: 24,
    default: 1,
  })
  for (const hours of [1, 2, 24]) expect(v.safeParse(descriptor.schema, hours).success).toBe(true)
  for (const hours of [0, -1, 0.5, 25, Number.NaN, Number.POSITIVE_INFINITY])
    expect(v.safeParse(descriptor.schema, hours).success).toBe(false)
})

test('enabled Codex has a separate machine-scoped minute quota-read interval', () => {
  const descriptor = presentSetting('providers.codexUsageRefreshSeconds')
  expect(descriptor.scope).toBe('machine')
  expect(descriptor.default).toBe(60)
  expect(SETTINGS_JSON_SCHEMA.properties['providers.codexUsageRefreshSeconds']).toMatchObject({
    type: 'integer',
    minimum: 60,
    default: 60,
  })
  expect(presentSetting('providers.usageRefreshSeconds').default).toBe(300)
})
