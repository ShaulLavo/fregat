import { expect, test } from 'vitest'
import { analysisLimitCodeUnits, inputConsumerConfiguration } from '../input-configurations.mjs'
import { inputPlatformPlugins } from '../src/inputPlatformPlugins.ts'
import { createLineGutterPlugin } from '@singapore-editor/gutters/line-gutter'

const analysisPlugins = [
  'editor.mergeConflicts',
  'editor.bracketMatch',
  'editor.occurrenceHighlight',
  'editor.documentLink',
]

test('the Platform composition above the analysis limit keeps only the line gutter', () => {
  const configuration = inputConsumerConfiguration(
    'platform',
    'short-lines',
    analysisLimitCodeUnits + 1,
  )
  expect(inputPlatformPlugins(configuration.analysis).map((plugin) => plugin.name)).toEqual([
    createLineGutterPlugin().name,
  ])
})

test('the Platform composition at the analysis boundary includes all analysis plugins', () => {
  const configuration = inputConsumerConfiguration('platform', 'ordinary', analysisLimitCodeUnits)
  const names = inputPlatformPlugins(configuration.analysis).map((plugin) => plugin.name)
  expect(names).toHaveLength(7)
  expect(names).toEqual(expect.arrayContaining(analysisPlugins))
})
