import { Editor } from '@singapore-editor/core/editor'
import {
  createEditorTextBuffer,
  createEditorBufferSession,
  type TextSnapshot,
} from '@singapore-editor/core/document'
import { createShikiWorkerOwner, createShikiHighlighterPlugin } from '@singapore-editor/core/shiki'
import { createEditorFindPlugin } from '@singapore-editor/find'
import { createMinimapPlugin } from '@singapore-editor/minimap'
import {
  createLspContentChangesInSnapshot,
  type LspTextDocumentSnapshot,
} from '@singapore-editor/lsp'
import '@singapore-editor/core/style.css'
import '@singapore-editor/find/style.css'

type Diagnostic = { readonly name: string; readonly detail?: Readonly<Record<string, unknown>> }
let active: ReturnType<typeof open> | null = null
let released: WeakRef<object>[] = []
let totals: Record<string, { count: number; units: number }> = {}

function record(event: Diagnostic) {
  if (
    ![
      'textSnapshot.materializeFullText',
      'textSnapshot.readRange',
      'lsp.contentChanges.path',
    ].includes(event.name)
  )
    return
  const name = String(event.detail?.path ?? event.name)
  const item = (totals[name] ??= { count: 0, units: 0 })
  item.count++
  item.units += Number(event.detail?.length ?? 0)
}

function descriptor(textSnapshot: TextSnapshot): LspTextDocumentSnapshot {
  return {
    textSnapshot,
    lineStarts: {
      length: textSnapshot.lineCount,
      at: (row) => (row < textSnapshot.lineCount ? textSnapshot.lineStart(row) : undefined),
      indexForOffset: (offset) => textSnapshot.lineAt(offset),
      toArray: () =>
        Array.from({ length: textSnapshot.lineCount }, (_, row) => textSnapshot.lineStart(row)),
    },
  }
}

function open(size: number, instrumented: boolean) {
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = instrumented ? record : null
  totals = {}
  const line = `needle ${'x'.repeat(4088)}\n`
  const buffer = createEditorTextBuffer(line.repeat(Math.ceil(size / line.length)).slice(0, size))
  const owner = createShikiWorkerOwner()
  const editor = new Editor(document.querySelector<HTMLElement>('#editor')!, {
    lineHeight: 20,
    tabSize: 4,
    detectIndentation: false,
    plugins: [
      createShikiHighlighterPlugin({
        workerOwner: owner,
        languages: { typescript: 'copy-proof' },
        resolveLanguage: async () => [
          { name: 'copy-proof', scopeName: 'source.copy-proof', patterns: [] },
        ],
        resolveTheme: async () => ({
          name: 'github-dark',
          settings: [{ settings: { foreground: '#ffffff', background: '#000000' } }],
        }),
      }),
      createEditorFindPlugin(),
      createMinimapPlugin(),
    ],
  })
  let previous = descriptor(buffer.getTextSnapshot())
  const unsubscribe = buffer.subscribe(({ change }) => {
    const next = descriptor(buffer.getTextSnapshot())
    createLspContentChangesInSnapshot(previous, next, { incremental: true, edits: change.edits })
    previous = next
  })
  editor.attachSession(createEditorBufferSession(buffer), {
    documentId: 'consumers',
    languageId: 'typescript',
  })
  editor.focus()
  return { editor, buffer, owner, unsubscribe }
}

async function dispose() {
  if (!active) return
  released = [new WeakRef(active.editor), new WeakRef(active.buffer)]
  active.unsubscribe()
  active.editor.dispose()
  await active.owner.dispose()
  active = null
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = null
}

const bridge = {
  open(size: number, instrumented: boolean) {
    active = open(size, instrumented)
  },
  observe: () => ({ state: active?.editor.getState(), totals }),
  reset: () => {
    totals = {}
  },
  async settle() {
    await active?.owner.awaitIdleFence()
  },
  dispose,
  retained: () => released.filter((reference) => reference.deref()).length,
}
declare global {
  var __consumers: typeof bridge
}
globalThis.__consumers = bridge
