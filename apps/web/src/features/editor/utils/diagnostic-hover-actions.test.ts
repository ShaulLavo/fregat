import { describe, expect, it, vi } from 'vitest'
import { diagnosticHoverActions } from './diagnostic-hover-actions'

describe('diagnostic hover handoff', () => {
  it.each([1, 2])(
    'opens the selected diagnostic with severity %s and exact optional metadata',
    async (severity) => {
      const request = vi.fn(async () => true)
      const actions = diagnosticHoverActions(request)
      const diagnostic = {
        range: { start: { line: 2, character: 3 }, end: { line: 2, character: 8 } },
        message: 'exact message\nsecond line',
        severity: severity as 1 | 2,
      }
      const action = actions({
        documentUri: 'file:///repo/a%20b.ts',
        textVersion: 3,
        diagnostic,
      })[0]
      expect(action?.label).toBe('Fix with AI')
      await action!.run()
      expect(request).toHaveBeenCalledExactlyOnceWith({
        path: 'repo/a b.ts',
        range: diagnostic.range,
        message: diagnostic.message,
        severity,
        code: null,
        source: null,
        surface: 'hover',
      })
    },
  )
  it('preserves code/source and forwards mutation rejection for visible action feedback', async () => {
    const failure = new Error('Could not open draft')
    const request = vi.fn(async () => {
      throw failure
    })
    const diagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: 'wrong type',
      code: 2322,
      source: 'typescript',
    }
    const action = diagnosticHoverActions(request)({
      documentUri: 'file:///repo/a.ts',
      textVersion: 0,
      diagnostic,
    })[0]
    expect(action).toBeDefined()
    await expect(action!.run()).rejects.toBe(failure)
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ code: '2322', source: 'typescript' }),
    )
  })
  it('does not offer file repair for a virtual document', () => {
    expect(
      diagnosticHoverActions(vi.fn())({
        documentUri: 'settings-json:user',
        textVersion: 0,
        diagnostic: {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: 'invalid',
        },
      }),
    ).toEqual([])
  })
})
