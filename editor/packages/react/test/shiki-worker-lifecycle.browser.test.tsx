import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import githubDarkTheme from '@shikijs/themes/github-dark'
import typeScriptWasmUrl from 'tree-sitter-typescript/tree-sitter-typescript.wasm?url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShikiHighlighterPlugin } from '@singapore-editor/core/shiki'

import { EditorHost, useEditor } from '../src'
import { createTreeSitterLanguagePlugin } from '../../tree-sitter/src/index'

const EDITOR_COUNT = 6
type WorkerKind = 'shiki' | 'tree-sitter' | 'unknown'

const liveWorkers = new Map<Worker, WorkerKind>()
const createdWorkers = new Map<WorkerKind, number>()
const STRICT_MODE_PLUGINS = [
  createTypeScriptPlugin(),
  createShikiHighlighterPlugin({
    resolveLanguage: async () => (await import('@shikijs/langs/typescript')).default,
    resolveTheme: async () => ({
      ...githubDarkTheme,
      name: githubDarkTheme.name ?? 'github-dark',
    }),
  }),
]
let root: Root | null = null

describe('Shiki worker ownership', () => {
  afterEach(() => {
    root?.unmount()
    root = null
    for (const worker of liveWorkers.keys()) worker.terminate()
    liveWorkers.clear()
    createdWorkers.clear()
    vi.unstubAllGlobals()
  })

  it('keeps one live worker per Wasm consumer under StrictMode', async () => {
    trackLiveWorkers()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    root.render(
      <StrictMode>
        {Array.from({ length: EDITOR_COUNT }, (_value, index) => (
          <ShikiEditor index={index} key={index} />
        ))}
      </StrictMode>,
    )

    await expect.poll(liveEditorCount, { timeout: 20_000 }).toBe(EDITOR_COUNT)
    await expect.poll(shikiTokensApplied, { timeout: 20_000 }).toBe(true)
    await expect.poll(() => liveWorkerCount('tree-sitter'), { timeout: 20_000 }).toBe(1)
    await expect.poll(() => liveWorkerCount('shiki'), { timeout: 20_000 }).toBe(1)
    expect(liveWorkers.size).toBe(2)
    expect(createdWorkers.get('tree-sitter')).toBe(1)
    expect(createdWorkers.get('shiki')).toBe(1)
    expect(createdWorkers.get('unknown')).toBeUndefined()
  }, 30_000)
})

function ShikiEditor({ index }: { readonly index: number }) {
  const text = `export const value${index} = ${index}`
  const controller = useEditor({
    document: {
      documentId: `strict-mode-${index}.ts`,
      languageId: 'typescript',
      text,
    },
    plugins: STRICT_MODE_PLUGINS,
  })

  return <EditorHost controller={controller} style={{ height: 80, width: 320 }} />
}

function trackLiveWorkers(): void {
  const NativeWorker = globalThis.Worker

  class TrackingWorker extends NativeWorker {
    public constructor(scriptURL: string | URL, options?: WorkerOptions) {
      super(scriptURL, options)
      const kind = workerKind(scriptURL)
      liveWorkers.set(this, kind)
      createdWorkers.set(kind, (createdWorkers.get(kind) ?? 0) + 1)
    }

    public override terminate(): void {
      liveWorkers.delete(this)
      super.terminate()
    }
  }

  vi.stubGlobal('Worker', TrackingWorker)
}

function createTypeScriptPlugin() {
  return createTreeSitterLanguagePlugin(
    [
      {
        id: 'typescript',
        extensions: ['.ts'],
        aliases: ['typescript'],
        wasmUrl: typeScriptWasmUrl,
      },
    ],
    { name: 'strict-mode-tree-sitter-typescript' },
  )
}

function liveEditorCount(): number {
  return document.querySelectorAll('.editor').length
}

function shikiTokensApplied(): boolean {
  const highlights = globalThis.CSS?.highlights
  if (!highlights) return false
  return Array.from(highlights.keys()).some((name) => name.startsWith('editor-shared-token-'))
}

function liveWorkerCount(kind: WorkerKind): number {
  let count = 0
  for (const workerKind of liveWorkers.values()) {
    if (workerKind === kind) count += 1
  }
  return count
}

function workerKind(scriptURL: string | URL): WorkerKind {
  const url = String(scriptURL)
  if (url.includes('shiki.worker')) return 'shiki'
  if (url.includes('treeSitter.worker')) return 'tree-sitter'
  if (url.startsWith('blob:')) return 'tree-sitter'
  return 'unknown'
}
