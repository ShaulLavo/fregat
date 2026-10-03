import { expect, test } from 'vitest'
import * as v from 'valibot'
import { descriptorFor } from '../settings/keys'
import { SETTINGS_JSON_SCHEMA } from '../settings/schema'

const ID = 'providers.proxyUsageRequestIntervalHours'

test('pooled Codex usage has a machine-only interval with an explicit hourly minimum', () => {
  const descriptor = descriptorFor(ID)
  expect(descriptor.scope).toBe('machine')
  expect(descriptor.default).toBe(1)
  expect(descriptor.description).toContain('At most one request per account per hour')
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
