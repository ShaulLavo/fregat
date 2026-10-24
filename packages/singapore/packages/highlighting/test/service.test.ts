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

test('terminal disposal rejects reentrant diff callbacks and shares one completion', async () => {
  const service = createHighlightingService()
  const { createTextDiff } = await import('@singapore-editor/diff')
  const file = createTextDiff({
    oldFile: { path: 'terminal.js', text: 'const a = 1;' },
    newFile: { path: 'terminal.js', text: 'const a = 2;' },
  })
  const observed: unknown[] = []
  let nested: Promise<void> | undefined
  service.showDiff(
    {
      setFile() {},
      releaseSyntax() {
        observed.push(service.inspect().disposed)
        try {
          service.syntaxProvider()
          observed.push('admitted')
        } catch (error) {
          observed.push(error)
        }
        nested = service.dispose()
      },
    },
    file,
    'stacked',
    { current: () => ({ format: 'editor' }) },
  )
  const disposal = service.dispose()
  await disposal
  await nested
  expect(observed).toEqual([true, expect.objectContaining({ code: 'disposed' })])
  expect(nested).toBe(disposal)
})
