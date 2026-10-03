import { expect, test } from 'vitest'
import { SETTINGS_DOCUMENTATION, presentSetting } from '../settings/documentation'
import { descriptorFor, SETTING_IDS } from '../settings/keys'
import { registryProblems } from '../settings/registry'

test('every registered setting has one documentation entry', () => {
  expect(Object.keys(SETTINGS_DOCUMENTATION)).toEqual(SETTING_IDS)
})

test('startup definitions contain no setting prose or display titles', () => {
  const documentationFields = ['description', 'details', 'title', 'optionTitles', 'keywords']
  for (const id of SETTING_IDS) {
    const definition = descriptorFor(id)
    for (const field of documentationFields) expect(Object.hasOwn(definition, field)).toBe(false)
  }
})

test('presentation preserves the registered schema, default and policy', () => {
  const descriptors = Object.fromEntries(SETTING_IDS.map((id) => [id, presentSetting(id)]))
  expect(registryProblems(descriptors)).toEqual([])
  for (const id of SETTING_IDS) {
    const definition = descriptorFor(id)
    const descriptor = presentSetting(id)
    expect(descriptor.schema).toBe(definition.schema)
    expect(descriptor.default).toBe(definition.default)
    expect(descriptor.scope).toBe(definition.scope)
    expect(descriptor.description).toBe(SETTINGS_DOCUMENTATION[id].description)
  }
})

test('quiet concurrency presents its accepted copy with the advanced machine policy', () => {
  expect(presentSetting('developer.heavyJobQuietPolicy')).toMatchObject({
    title: 'Quiet job concurrency',
    details:
      'Use an empty allowedClasses array to hold new light jobs during measurements. The measurementCpus and concurrentCpus fields currently accept empty arrays, preserving host scheduling. CPU affinity requires a validated scheduling implementation.',
    description:
      'Classes allowed alongside a quiet measurement. Light jobs keep their memory and pressure checks. Empty CPU sets use the machine scheduler.',
    keywords: ['developer', 'heavy', 'quiet', 'concurrency', 'affinity'],
    scope: 'machine',
    widget: 'complex',
    category: 'Developer',
    visibility: 'advanced',
    default: { allowedClasses: ['light'], measurementCpus: [], concurrentCpus: [] },
  })
})
