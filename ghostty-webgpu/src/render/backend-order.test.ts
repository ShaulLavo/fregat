import { describe, expect, it } from 'vitest'
import { automaticGpuBackends } from './backend-order.js'
import { rendererPlatforms } from './tests/platforms.js'

describe('automatic GPU backend order', () => {
  it.each(rendererPlatforms)('selects the order for $name', ({ navigator, backend }) => {
    expect(automaticGpuBackends(navigator)).toEqual(
      backend === 'webgl2' ? ['webgl', 'webgpu'] : ['webgpu', 'webgl'],
    )
  })
})
