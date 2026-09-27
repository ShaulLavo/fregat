import { expect, test } from '../../../../../test/fixtures'

import { fileTreeIndentGuideVariables } from '@/features/workspace/utils/indent-guide-style'

test('uses the editor scope-line palette and weights exactly', () => {
  const variables = fileTreeIndentGuideVariables({
    syntax: {
      type: '#111111',
      keyword: '#222222',
      string: '#333333',
      number: '#444444',
      function: '#555555',
      variableBuiltin: '#666666',
    },
  })

  expect(variables).toMatchObject({
    '--tree-guide-1': 'color-mix(in srgb, #111111 34%, transparent)',
    '--tree-guide-6': 'color-mix(in srgb, #666666 30%, transparent)',
  })
})
