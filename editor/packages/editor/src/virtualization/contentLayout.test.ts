import { expect, it } from 'vitest'
import { assertContentLayout } from './contentLayout'

it('admits the content paint limits and refuses each oversized dimension', () => {
  expect(() => assertContentLayout(1_048_576, 10_000, 1_000_000)).not.toThrow()
  for (const dimensions of [
    [1_048_577, 1, 20],
    [1, 10_001, 20],
    [1, 1, 1_000_001],
  ] as const) {
    expect(() => assertContentLayout(dimensions[0], dimensions[1], dimensions[2])).toThrow(
      expect.objectContaining({
        code: 'EDITOR_CONTENT_LAYOUT_LIMIT',
        status: 413,
      }),
    )
  }
})
