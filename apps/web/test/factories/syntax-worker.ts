import { onTestFinished, vi } from 'vitest'
import {
  DocumentWorkerReader,
  type DocumentWorkerRead,
} from '@singapore-editor/core/internal/document-worker'
import { packEditorTokens, type EditorToken } from '@singapore-editor/core/syntax'
import type { TreeSitterWorkerRequest } from '../../../../editor/packages/tree-sitter/src/treeSitter/types'
import type { ShikiWorkerRequest } from '../../../../editor/packages/editor/src/shiki/workerTypes'
import { disposeHighlightingService } from '@/lib/highlighting/state/service'

type Request = TreeSitterWorkerRequest | ShikiWorkerRequest

type SyntaxWorkerOptions = {
  readonly workers: Set<SyntaxWorker>
  readonly reads: string[]
  readonly tokensForText: (text: string) => readonly EditorToken[]
  readonly onRead: (text: string) => void
}

class SyntaxWorker extends EventTarget implements Worker {
  onmessage: Worker['onmessage'] = null
  onerror: Worker['onerror'] = null
  onmessageerror: Worker['onmessageerror'] = null
  private readonly reader = new DocumentWorkerReader()
  private readonly documents = new Map<string, DocumentWorkerRead>()
  private readonly shiki: boolean
  private terminated = false
  constructor(
    url: string | URL,
    private readonly options: SyntaxWorkerOptions,
  ) {
    super()
    this.shiki = String(url).toLowerCase().includes('shiki')
    this.options.workers.add(this)
  }
  postMessage(request: Request): void {
    if (this.terminated) return
    let response: unknown
    try {
      response = { id: request.id, ok: true, result: this.answer(request.payload) }
    } catch (error) {
      response = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    queueMicrotask(() => {
      if (this.terminated) return
      this.onmessage?.call(
        this,
        new MessageEvent('message', {
          data: response,
        }),
      )
    })
  }
  terminate(): void {
    if (this.terminated) return
    this.terminated = true
    for (const read of this.documents.values()) read.dispose()
    this.documents.clear()
    this.reader.dispose()
    this.options.workers.delete(this)
  }
  private answer(payload: Request['payload']): unknown {
    if (payload.type === 'source') {
      const source = this.reader.apply(payload.command)
      return this.shiki ? { source } : source
    }
    if (payload.type === 'theme') return { theme: { foregroundColor: '#ffffff' } }
    if (payload.type === 'disposeDocument') {
      this.documents.get(payload.runtimeSessionId)?.dispose()
      this.documents.delete(payload.runtimeSessionId)
      return undefined
    }
    if (
      payload.type !== 'parse' &&
      payload.type !== 'edit' &&
      payload.type !== 'open' &&
      payload.type !== 'queryRange'
    )
      return undefined
    if ('source' in payload) {
      const read = this.reader.acquire(payload.source)
      if (!read) throw new TypeError('The syntax fixture must receive an admitted canonical read')
      this.documents.get(payload.runtimeSessionId)?.dispose()
      this.documents.set(payload.runtimeSessionId, read)
    }
    const read = this.documents.get(payload.runtimeSessionId)
    if (!read?.isValid())
      throw new TypeError('The syntax fixture must retain its admitted parsed source')
    const text = read.text.readRange(0, read.text.length)
    this.options.reads.push(text)
    this.options.onRead(text)
    const tokensPacked = packEditorTokens(this.options.tokensForText(text))
    if (!('snapshotVersion' in payload)) return { tokensPacked }
    const result = {
      documentId: payload.documentId,
      snapshotVersion: payload.snapshotVersion,
      languageId: payload.languageId,
      captures: [],
      folds: [],
      brackets: [],
      errors: [],
      injections: [],
      timings: [],
      tokensPacked,
    }
    return payload.type === 'queryRange' ? { ...result, range: payload.range } : result
  }
}

export function installSyntaxWorker(
  tokensForText: (text: string) => readonly EditorToken[],
  onRead: (text: string) => void = () => undefined,
) {
  const workers = new Set<SyntaxWorker>()
  const reads: string[] = []
  class FixtureWorker extends SyntaxWorker {
    constructor(url: string | URL) {
      super(url, { workers, reads, tokensForText, onRead })
    }
  }
  vi.stubGlobal('Worker', FixtureWorker)
  onTestFinished(() => releaseSyntaxFixture(workers))
  return { reads }
}

async function releaseSyntaxFixture(workers: Set<SyntaxWorker>): Promise<void> {
  try {
    await disposeHighlightingService()
  } finally {
    for (const worker of workers) worker.terminate()
    vi.unstubAllGlobals()
  }
}
