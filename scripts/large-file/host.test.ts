import { expect, test } from 'vitest'

import { rasterPath } from './host'

test('labels from page rasterization, whatever WebGL uses', () => {
  expect(rasterPath('disabled_software')).toBe('software')
  expect(rasterPath('enabled')).toBe('gpu')
  expect(rasterPath('enabled_on')).toBe('gpu')
  expect(rasterPath('unreported')).toBe('unknown')
})
