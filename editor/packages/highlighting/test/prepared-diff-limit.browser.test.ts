import { expect, test } from 'vitest'
import { createTextDiff, type DiffSyntaxSourceReader } from '@singapore-editor/diff'
import { createHighlightingService, type HighlightingThemeSource } from '../src/index'

test('prepared diff sessions use the configured cap and recolor under the next request cap', async () => {
  let limit = 8
  let foreground = '#eeeeee'
  const listeners = new Set<() => void>()
  const source: HighlightingThemeSource = {
    current: () => ({ format: 'vscode', id: 'review' }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const sent: { type: string; maxLineLength?: number; theme?: string }[] = []
  const errors: string[] = []
  const service = createHighlightingService({
    shikiWorker: () => {
      const worker = new Worker(
        new URL('../../editor/src/shiki/shiki.worker.ts', import.meta.url),
        { type: 'module' },
      )
      worker.addEventListener('message', (event) => {
        if (!event.data.ok) errors.push(event.data.error)
      })
      const postMessage = worker.postMessage.bind(worker)
      worker.postMessage = (message) => {
        sent.push({
          type: message.payload.type,
          maxLineLength: message.payload.maxLineLength,
          theme: message.payload.theme,
        })
        postMessage(message)
      }
      return worker
    },
    maxTokenizationLineLength: () => limit,
    resolveTheme: async () => ({
      name: 'review',
      type: 'dark',
      colors: { 'editor.foreground': foreground },
      tokenColors: [{ scope: ['keyword', 'storage'], settings: { foreground: '#ff0000' } }],
    }),
  })
  const file = createTextDiff({
    oldFile: { path: 'review.ts', languageId: 'typescript', text: 'const longer = 1\n' },
    newFile: { path: 'review.ts', languageId: 'typescript', text: 'const longer = 2\n' },
  })
  let sources: readonly DiffSyntaxSourceReader[] = []
  let shown: { dispose(): void } | null = null
  try {
    expect(await service.prepareDiff(file, source)).toBe(true)
    expect(service.inspect().shiki?.untokenizedLines).toBe(2)
    shown = service.showDiff(
      {
        setFile: (_file, prepared = []) => {
          void Promise.resolve(prepared).then((next) => {
            sources = next
          })
        },
      },
      file,
      'stacked',
      source,
    )
    await Promise.resolve()
    expect(sources).toHaveLength(2)
    for (const value of sources)
      expect(value.tokens.toTokens()).toEqual([{ start: 0, end: 16, style: { color: '#EEEEEE' } }])
    expect(listeners.size).toBe(2)
    limit = 100
    foreground = '#dddddd'
    for (const listener of listeners) listener()
    await expect
      .poll(
        () => ({
          count: service.inspect().shiki?.untokenizedLines,
          requests: sent.filter((value) => value.maxLineLength === 100).length,
          errors,
        }),
        { message: 'two prepared sessions reopen under cap 100' },
      )
      .toEqual({ count: 0, requests: 2, errors: [] })
    for (const value of sources) expect(value.tokens.toTokens().length).toBeGreaterThan(1)
  } finally {
    shown?.dispose()
    await service.dispose()
    expect(service.inspect().pendingHighlights).toBe(0)
  }
})
