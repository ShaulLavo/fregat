import { describe, expect, it } from 'vitest'

import { requestedFileTransitionMode } from '@/features/editor/utils/file-transition-mode'

describe('requestedFileTransitionMode', () => {
  it('is off unless the URL asks for it', () => {
    expect(requestedFileTransitionMode('')).toBeNull()
    expect(requestedFileTransitionMode('?workspace=/tmp/repo')).toBeNull()
  })

  it('reads an explicit mode', () => {
    expect(requestedFileTransitionMode('?transition=diffusion')).toBe('diffusion')
    expect(requestedFileTransitionMode('?transition=token')).toBe('token')
    expect(requestedFileTransitionMode('?transition=autoregressive')).toBe('autoregressive')
  })

  it('falls back to the default mode for truthy switches', () => {
    expect(requestedFileTransitionMode('?transition=1')).toBe('diffusion')
    expect(requestedFileTransitionMode('?transition=on')).toBe('diffusion')
  })

  it('ignores unknown and empty values', () => {
    expect(requestedFileTransitionMode('?transition=sparkle')).toBeNull()
    expect(requestedFileTransitionMode('?transition=')).toBeNull()
  })
})
