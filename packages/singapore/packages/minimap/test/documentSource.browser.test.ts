import { createEditorBufferSession, createEditorTextBuffer } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import { expect, it, vi } from 'vitest'
import { retainMinimapDocumentSource } from '../src/documentSource'
import { resolveMinimapOptions } from '../src/options'
import type { MinimapWorkerRequest } from '../src/types'

it.skipIf(typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined')(
  'admits clipped canonical source through a real browser worker and retires the final view lease',
  async () => {
    const buffer = createEditorTextBuffer('ab😀\r\ncdefghijkl\n尾')
    const view = createEditorBufferSession(buffer)
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'minimap-source' })
    const worker = new (recordedWorkerConstructor())(
      new URL('../src/minimap.worker.ts', import.meta.url),
      {
        type: 'module',
      },
    )
    const terminate = vi.spyOn(worker, 'terminate')
    const retained = retainMinimapDocumentSource(analysis.contributions, {
      maxColumn: 4,
      onMessage: () => {},
      workerFactory: () => worker,
    })
    if (!retained) expect.unreachable('Document contribution was not retained')
    const { source, lease } = retained
    const mainCanvas = new OffscreenCanvas(100, 100)
    const decorationsCanvas = new OffscreenCanvas(100, 100)
    const options = resolveMinimapOptions({ maxColumn: 4 })
    source.post(
      {
        type: 'init',
        options,
        mainCanvas,
        decorationsCanvas,
        baseStyles: {
          foreground: { r: 212, g: 212, b: 212, a: 255 },
          background: { r: 30, g: 30, b: 30, a: 255 },
          minimapBackground: { r: 30, g: 30, b: 30, a: 255 },
          foregroundOpacity: 1,
          selection: { r: 255, g: 255, b: 255, a: 64 },
          slider: 'rgba(121,121,121,.3)',
          sliderHover: 'rgba(121,121,121,.4)',
          sliderActive: 'rgba(121,121,121,.5)',
          fontFamily: 'monospace',
        },
      },
      [mainCanvas, decorationsCanvas],
    )
    const requests = () => worker.requests.filter((request) => request.type === 'projectSource')
    try {
      const initial = await lease.request()
      expect(initial?.receipt.kind).toBe('applied')
      expect(requests()[0]?.projection).toEqual({
        kind: 'reset',
        summary: {
          textLength: 17,
          lineStarts: [0, 5, 16],
          lines: [
            { text: 'ab😀', length: 4 },
            { text: 'cdef', length: 10 },
            { text: '尾', length: 1 },
          ],
        },
      })
      await lease.request()
      expect(requests()).toHaveLength(1)
      source.post({ type: 'updateTokens', tokens: [] })
      view.applyEdits([{ from: 7, to: 7, text: 'X' }])
      const changed = await lease.request()
      expect(changed?.receipt.base).toEqual(initial?.receipt.target)
      expect(changed?.tokensRebased).toBe(true)
      expect(requests().at(-1)?.projection).toEqual({
        kind: 'patch',
        edits: [{ from: 7, to: 7, text: 'X' }],
        summary: {
          textLength: 18,
          startLine: 1,
          deleteCount: 1,
          lines: [{ text: 'cdXe', length: 11 }],
        },
      })
      view.undo()
      const undone = await lease.request()
      expect(undone?.receipt.base).toEqual(changed?.receipt.target)
      expect(requests().at(-1)?.projection).toMatchObject({
        kind: 'patch',
        summary: { textLength: 17, lines: [{ text: 'cdef', length: 10 }] },
      })
      view.redo()
      await lease.request()
      lease.dispose()
      expect(terminate).toHaveBeenCalledOnce()
      expect(source.inspect().lifecycle).toBe('disposed')
    } finally {
      lease.dispose()
      analysis.dispose()
      worker.terminate()
    }
  },
  10_000,
)

function recordedWorkerConstructor() {
  return class extends Worker {
    public readonly requests: MinimapWorkerRequest[] = []

    public override postMessage(
      request: MinimapWorkerRequest,
      transfer?: Transferable[] | StructuredSerializeOptions,
    ): void {
      this.requests.push(request)
      if (Array.isArray(transfer)) {
        super.postMessage(request, transfer)
        return
      }
      super.postMessage(request, transfer)
    }
  }
}
