import { expect, test } from 'vitest'
import { createDiffPlugin, createTextDiff } from '@singapore-editor/diff'
import { createHighlightingService, type HighlightingThemeSource } from '../src/index'

const listeners = new Set<() => void>()
const theme: HighlightingThemeSource = {
  current: () => ({ format: 'vscode', id: 'loan-proof' }),
  subscribe: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
const file = () =>
  createTextDiff({
    oldFile: { path: 'loan.js', text: 'const before = 1;', languageId: 'javascript' },
    newFile: { path: 'loan.js', text: 'const after = 2;', languageId: 'javascript' },
  })

function workerBoundary() {
  const sent: string[] = []
  let color = '#ff0000'
  const service = createHighlightingService({
    resolveTheme: async () => ({
      name: 'loan-proof',
      tokenColors: [{ scope: ['keyword', 'storage'], settings: { foreground: color } }],
    }),
    shikiWorker: () => {
      const worker = new Worker(
        new URL('../../editor/src/shiki/shiki.worker.ts', import.meta.url),
        { type: 'module' },
      )
      const postMessage = worker.postMessage.bind(worker)
      worker.postMessage = (message) => {
        sent.push(message.payload.type)
        postMessage(message)
      }
      return worker
    },
  })
  return {
    service,
    sent,
    recolor(next: string) {
      color = next
      for (const listener of listeners) listener()
    },
  }
}

test('known-good real worker prepared view paints synchronously and retains its owner', async () => {
  const { service, sent } = workerBoundary()
  const plugin = createDiffPlugin({
    mode: 'document',
    syntaxBackend: service.documentBackend(theme),
  })
  let shown: { dispose(): void } | undefined
  try {
    expect(await service.prepareDiff(file(), theme)).toBe(true)
    const requests = sent.filter((type) => type === 'open').length
    shown = service.showDiff(plugin, file(), 'stacked', theme)
    expect(plugin.isSyntaxReady()).toBe(true)
    expect(plugin.getTokens().length).toBeGreaterThan(0)
    await service.awaitIdle()
    expect(sent.filter((type) => type === 'open')).toHaveLength(requests)
    shown.dispose()
    plugin.setFile(null)
    expect(service.inspect().disposed).toBe(false)
  } finally {
    shown?.dispose()
    plugin.setFile(null)
    await service.dispose()
  }
})

test('bounded real worker two-view requests share active immutable sources', async () => {
  const { service, sent, recolor } = workerBoundary()
  const backend = service.documentBackend(theme)
  const first = createDiffPlugin({ mode: 'document', syntaxBackend: backend })
  const second = createDiffPlugin({ mode: 'document', syntaxBackend: backend })
  let a: { dispose(): void } | undefined
  let b: { dispose(): void } | undefined
  try {
    await service.prepareDiff(file(), theme)
    a = service.showDiff(first, file(), 'stacked', theme)
    b = service.showDiff(second, file(), 'stacked', theme)
    await expect.poll(() => second.isSyntaxReady()).toBe(true)
    await service.awaitIdle()
    console.log('syntax200 two-view worker requests', JSON.stringify(sent))
    expect(sent.filter((type) => type === 'open')).toHaveLength(2)
    expect(second.getTokens()).toEqual(first.getTokens())
    a.dispose()
    first.setFile(null)
    expect(second.getTokens().length).toBeGreaterThan(0)
    expect(service.inspect().diffs).toMatchObject({ viewed: 1, borrowed: 2 })
    expect(service.inspect().disposed).toBe(false)
    recolor('#0000ff')
    await expect.poll(() => second.getTokens()[0]?.style.color?.toLowerCase()).toBe('#0000ff')
    expect(first.getTokens()).toEqual([])
  } finally {
    a?.dispose()
    b?.dispose()
    first.setFile(null)
    second.setFile(null)
    await service.dispose()
  }
})
