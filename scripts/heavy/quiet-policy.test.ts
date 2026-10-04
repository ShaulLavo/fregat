import * as v from 'valibot'
import { expect, test } from 'vitest'

import { SETTINGS_REGISTRY } from '../../packages/contracts/src/settings/keys'

const policy = SETTINGS_REGISTRY['developer.heavyJobQuietPolicy']

test('quiet concurrency defaults to light only with portable unrestricted CPU scheduling', () => {
  expect(policy.scope).toBe('machine')
  expect(v.parse(policy.schema, policy.default)).toEqual({
    allowedClasses: ['light'],
    concurrentCpus: [],
    measurementCpus: [],
  })
  expect(v.parse(policy.schema, { ...policy.default, allowedClasses: [] }).allowedClasses).toEqual(
    [],
  )
})

test.each(['suite', 'build', 'browser', 'bench'])(
  'the baseline policy rejects %s during quiet',
  (jobClass) => {
    expect(
      v.safeParse(policy.schema, { ...policy.default, allowedClasses: [jobClass] }).success,
    ).toBe(false)
  },
)

test.each(['measurementCpus', 'concurrentCpus'])(
  'CPU affinity in %s stays gated until validated',
  (key) => {
    expect(v.safeParse(policy.schema, { ...policy.default, [key]: [0] }).success).toBe(false)
  },
)
