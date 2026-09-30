import { describe, expect, test } from 'vitest'

import { createHighlightingService, highlightingGrammar, HighlightingError } from '../src/index'

describe('highlighting service without a worker', () => {
  test('reports an unavailable worker instead of tokenizing on the main thread', async () => {
    const service = createHighlightingService()
    const failure = await service.highlight('const a = 1', { language: 'ts' }).catch((e) => e)
    expect(failure).toBeInstanceOf(HighlightingError)
    expect(failure.code).toBe('unavailable')
  })

  test('rejects an aborted request before any work starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const service = createHighlightingService()
    const failure = await service
      .highlight('x', { language: 'ts', signal: controller.signal })
      .catch((e) => e)
    expect(failure.code).toBe('aborted')
    expect(failure.name).toBe('AbortError')
  })

  test('refuses work after disposal, and disposing twice is safe', async () => {
    const service = createHighlightingService()
    await service.dispose()
    await service.dispose()
    const failure = await service.highlight('x', { language: 'ts' }).catch((e) => e)
    expect(failure.code).toBe('disposed')
    expect(() => service.syntaxProvider()).toThrow(HighlightingError)
  })
})

describe('highlightingGrammar', () => {
  test('keeps the wide Shiki language set and its aliases', () => {
    expect(highlightingGrammar('ts')).toBe('typescript')
    expect(highlightingGrammar('typescriptreact')).toBe('tsx')
    expect(highlightingGrammar('javascriptreact')).toBe('jsx')
    expect(highlightingGrammar(' Shell ')).toBe('shellscript')
    // Languages only Shiki supplies stay available to fences.
    expect(highlightingGrammar('haskell')).toBe('haskell')
    expect(highlightingGrammar('no-such-language')).toBeNull()
  })
})
