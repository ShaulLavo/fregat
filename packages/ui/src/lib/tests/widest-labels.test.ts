import { expect, it } from 'vitest'

import { widestLabels } from '@workspace/ui/lib/widest-labels'

it('keeps each option once and always includes the current label', () => {
  expect(widestLabels(['Local', 'Mac', 'Local'], 'Mac')).toEqual(['Local', 'Mac'])
  expect(widestLabels(['Local'], 'Gone machine')).toEqual(['Local', 'Gone machine'])
})
