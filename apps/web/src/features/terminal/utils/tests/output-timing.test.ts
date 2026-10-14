import { describe } from 'vitest'
import type { TerminalOutputTiming } from 'ghostty-webgpu'

import { outputTimingParts } from '@/features/terminal/utils/output-timing'
import { expect, test as it } from '../../../../../test/fixtures'

const base: TerminalOutputTiming = {
  firstOutputAt: 103.25,
  lastOutputAt: 150,
  writes: 3,
  hidden: false,
  presentation: 'frame',
  desynchronized: false,
  rendererBackend: 'webgl2',
}

describe('outputTimingParts', () => {
  it('lists input, output, draw and shown times in order', () => {
    expect(outputTimingParts({ ...base, inputAt: 100, drawnAt: 151.5, presentedAt: 166 })).toEqual([
      { label: 'First output', value: '3.3 ms' },
      { label: 'Output', value: '47 ms' },
      { label: 'Drawn', value: '+1.5 ms' },
      { label: 'Shown', value: '+15 ms' },
    ])
  })

  it('leaves out the input time when output came without input', () => {
    expect(outputTimingParts({ ...base, drawnAt: 152 })).toEqual([
      { label: 'Output', value: '47 ms' },
      { label: 'Drawn', value: '+2.0 ms' },
    ])
  })

  it('says when no frame drew the output, and why', () => {
    expect(outputTimingParts(base).at(-1)).toEqual({ label: 'Drawn', value: 'no change' })
    expect(outputTimingParts({ ...base, hidden: true }).at(-1)).toEqual({
      label: 'Drawn',
      value: 'page hidden',
    })
  })
})
