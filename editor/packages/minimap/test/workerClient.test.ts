import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import { EditorTokenStore } from '@singapore-editor/core/syntax'
import { describe, expect, it, vi } from 'vitest'
import { documentSummaryPayload } from '../src/summary'
import { createViewHarness, minimapHost, viewSnapshot } from './documentHarness'
import { MinimapWorkerClient } from '../src/workerClient'
import { resolveMinimapOptions } from '../src/options'

describe('MinimapWorkerClient document contribution', () => {
  it('keeps retained hidden source idle until a view requests current work', async () => {
    const fixture = createViewHarness('ab\n'.repeat(2_000))
    try {
      await fixture.runtime.settle()
      fixture.host.root.hidden = true
      fixture.worker.requests.length = 0
      for (let edit = 0; edit < 10; edit++) fixture.view.applyEdits([{ from: 1, to: 1, text: 'X' }])
      const reads = vi.spyOn(fixture.buffer.getTextSnapshot(), 'readRange')
      await fixture.runtime.settle()
      expect(fixture.worker.requests.filter((request) => request.type === 'render')).toHaveLength(0)
      expect(reads.mock.calls.reduce((units, [from, to]) => units + to - from, 0)).toBe(0)
      expect(
        fixture.worker.requests.filter((request) => request.type === 'projectSource'),
      ).toHaveLength(0)
      fixture.host.root.hidden = false
      fixture.client.update(fixture.snapshot(), 'layout')
      await fixture.runtime.settle()
      expect(fixture.worker.document).toMatchObject(
        documentSummaryPayload(fixture.buffer.getTextSnapshot(), 16),
      )
    } finally {
      fixture.dispose()
    }
  })

  it('posts source before its correlated initial frame and releases the final lease', async () => {
    const fixture = createViewHarness('ab😀\ncdefghijkl\n尾')
    try {
      await fixture.runtime.settle()
      const projected = fixture.worker.requests.find((request) => request.type === 'projectSource')
      const rendered = fixture.worker.requests.find((request) => request.type === 'render')
      expect(projected?.target).toEqual(rendered?.source?.target)
      expect(projected?.identity).toEqual(rendered?.source?.identity)
      expect(fixture.worker.requests.indexOf(projected!)).toBeLessThan(
        fixture.worker.requests.indexOf(rendered!),
      )
      expect(fixture.client.inspectWorker().lifecycle).toBe('ready')
      fixture.client.dispose()
      expect(fixture.worker.terminate).toHaveBeenCalledOnce()
      expect(fixture.worker.onmessage).toBeNull()
      expect(fixture.client.inspectWorker().lifecycle).toBe('disposed')
    } finally {
      fixture.dispose()
    }
  })

  it.each(['selection', 'layout', 'viewport'])(
    'keeps exact source when %s arrives before content',
    async (kind) => {
      const initial = Array.from({ length: 64 }, (_, index) => `//${index}😀`).join('\n')
      const fixture = createViewHarness(initial)
      try {
        await fixture.runtime.settle()
        for (let index = 0; index < 12; index++) {
          fixture.view.applyEdits([{ from: 24 + index * 4, to: 24 + index * 4, text: 'x\ny\n' }])
          if (index === 0) fixture.client.update(fixture.snapshot(), kind)
          fixture.client.update(fixture.snapshot(), 'content')
        }
        await fixture.runtime.settle()
        expect(fixture.worker.document).toMatchObject(
          documentSummaryPayload(fixture.buffer.getTextSnapshot(), 16),
        )
        expect(fixture.worker.document.lines).toHaveLength(88)
        for (let index = 0; index < 12; index++) {
          fixture.view.undo()
          if (index === 0) fixture.client.update(fixture.snapshot(), kind)
          fixture.client.update(fixture.snapshot(), 'content')
        }
        await fixture.runtime.settle()
        expect(fixture.worker.document).toMatchObject(
          documentSummaryPayload(fixture.buffer.getTextSnapshot(), 16),
        )
        expect(fixture.worker.document.lines).toHaveLength(64)
        for (let index = 0; index < 12; index++) {
          fixture.view.redo()
          if (index === 0) fixture.client.update(fixture.snapshot(), kind)
          fixture.client.update(fixture.snapshot(), 'content')
        }
        await fixture.runtime.settle()
        expect(fixture.worker.document.lines).toHaveLength(88)
        expect(fixture.worker.document).toMatchObject(
          documentSummaryPayload(fixture.buffer.getTextSnapshot(), 16),
        )
      } finally {
        fixture.dispose()
      }
    },
  )

  it('keeps scroll and metadata demand separate from same-point source admission', async () => {
    const fixture = createViewHarness('one\ntwo\nthree\nfour\nfive')
    try {
      await fixture.runtime.settle()
      const sourceCount = fixture.worker.requests.filter(
        (request) => request.type === 'projectSource',
      ).length
      const snapshot = fixture.snapshot()
      const viewport = { ...snapshot.viewport, scrollTop: 40, scrollRow: 2 }
      fixture.client.updateViewport(viewport)
      fixture.client.setExternalDecorations([
        {
          startLineNumber: 2,
          endLineNumber: 2,
          startColumn: 1,
          endColumn: 2,
          color: '#ff0000',
          position: 'gutter',
        },
      ])
      fixture.client.update(fixture.snapshot({ viewport }), 'layout')
      await fixture.runtime.settle()
      expect(
        fixture.worker.requests.filter((request) => request.type === 'projectSource'),
      ).toHaveLength(sourceCount)
      const posted = fixture.worker.requests.findLast(
        (request) => request.type === 'updateViewport' || request.type === 'updateLayout',
      )
      expect(posted?.viewport.scrollTop).toBe(40)
      expect(
        fixture.worker.requests.some((request) => request.type === 'updateExternalDecorations'),
      ).toBe(true)
    } finally {
      fixture.dispose()
    }
  })

  it('rebinds replacement and clear with fresh canvases and released source scopes', async () => {
    const fixture = createViewHarness('first\ndocument')
    const next = createEditorDocumentAnalysis({
      buffer: createEditorTextBuffer('next😀\ndocument'),
      documentId: 'next',
    })
    try {
      await fixture.runtime.settle()
      const canvas = fixture.host.mainCanvas
      fixture.client.setDocumentContributions(next.contributions, viewSnapshot(next))
      fixture.client.update(viewSnapshot(next), 'document')
      await fixture.runtime.settle()
      expect(fixture.worker.terminate).toHaveBeenCalledOnce()
      expect(canvas.isConnected).toBe(false)
      const worker = fixture.runtime.workers[1]!
      expect(worker.document).toMatchObject(
        documentSummaryPayload(next.buffer.getTextSnapshot(), 16),
      )
      fixture.client.setDocumentContributions(null, viewSnapshot(next))
      expect(worker.terminate).toHaveBeenCalledOnce()
      fixture.client.setDocumentContributions(next.contributions, viewSnapshot(next))
      await fixture.runtime.settle()
      expect(fixture.runtime.workers[2]?.document).toMatchObject(
        documentSummaryPayload(next.buffer.getTextSnapshot(), 16),
      )
    } finally {
      next.dispose()
      fixture.dispose()
    }
  })

  it('gives two canvases independent frame demand and worker lifetime on one source owner', async () => {
    const fixture = createViewHarness('shared😀\nsource')
    const host = minimapHost()
    const peer = new MinimapWorkerClient({
      host,
      options: resolveMinimapOptions({ maxColumn: 16 }),
      snapshot: fixture.snapshot(),
      decorations: [],
      onLayoutWidth: () => {},
      reservedLane: () => 0,
      contributions: fixture.analysis.contributions,
    })
    try {
      await fixture.runtime.settle()
      const peerWorker = fixture.runtime.workers[1]!
      fixture.view.applyEdits([{ from: 7, to: 7, text: '\nnew\n' }])
      fixture.client.update(fixture.snapshot(), 'content')
      peer.update(fixture.snapshot(), 'content')
      await fixture.runtime.settle()
      expect(fixture.worker.document).toMatchObject(
        documentSummaryPayload(fixture.buffer.getTextSnapshot(), 16),
      )
      expect(peerWorker.document).toMatchObject(
        documentSummaryPayload(fixture.buffer.getTextSnapshot(), 16),
      )
      const peerFrames = peerWorker.requests.filter((request) => request.type === 'render').length
      fixture.client.updateViewport({ ...fixture.snapshot().viewport, scrollTop: 20, scrollRow: 1 })
      await fixture.runtime.settle()
      expect(peerWorker.requests.filter((request) => request.type === 'render')).toHaveLength(
        peerFrames,
      )
      fixture.client.dispose()
      expect(peerWorker.terminate).not.toHaveBeenCalled()
      peer.dispose()
      expect(peerWorker.terminate).toHaveBeenCalledOnce()
    } finally {
      peer.dispose()
      host.root.remove()
      host.colorScope.remove()
      fixture.dispose()
    }
  })

  it('retains token coordinates across edits and applies a same-point color refresh', async () => {
    const fixture = createViewHarness('abc\ndef')
    try {
      const initial = EditorTokenStore.fromTokens([
        { start: 0, end: 3, style: { color: '#ff0000' } },
      ])
      fixture.client.update(fixture.snapshot({ tokens: initial }), 'tokens')
      await fixture.runtime.settle()
      fixture.worker.requests.length = 0
      fixture.view.applyEdits([{ from: 1, to: 1, text: 'x' }])
      const shifted = initial.replaceRange(
        0,
        1,
        {
          starts: new Uint32Array([0]),
          ends: new Uint32Array([4]),
          styleIds: new Uint32Array([0]),
        },
        { delta: 1, keepsLiveRanges: true },
      )
      fixture.client.update(fixture.snapshot({ tokens: shifted }), 'content')
      await fixture.runtime.settle()
      expect(fixture.worker.requests.some((request) => request.type === 'updateTokens')).toBe(false)
      expect(fixture.worker.document.tokens[0]?.end).toBe(4)
      const refreshed = EditorTokenStore.fromTokens([
        { start: 0, end: 4, style: { color: '#00ff00' } },
      ])
      fixture.client.update(fixture.snapshot({ tokens: refreshed }), 'tokens')
      await fixture.runtime.settle()
      expect(fixture.worker.requests.some((request) => request.type === 'updateTokenRange')).toBe(
        true,
      )
      expect(fixture.worker.document.tokens[0]?.color).toEqual({ r: 0, g: 255, b: 0, a: 255 })
    } finally {
      fixture.dispose()
    }
  })
  it('waits for source acknowledgement before posting the frame for an edited revision', async () => {
    const fixture = createViewHarness('a\nb')
    try {
      await fixture.runtime.settle()
      fixture.worker.autoSource = false
      fixture.worker.requests.length = 0
      fixture.view.applyEdits([{ from: 1, to: 1, text: '\nx\ny' }])
      fixture.client.update(fixture.snapshot(), 'content')
      await fixture.runtime.settle()
      expect(fixture.worker.requests.some((request) => request.type === 'projectSource')).toBe(true)
      expect(fixture.worker.requests.some((request) => request.type === 'render')).toBe(false)
      fixture.worker.acknowledgeSource()
      await fixture.runtime.settle()
      const request = fixture.worker.requests.findLast((request) => request.type === 'render')
      expect(request?.source?.target.revision).toBe(fixture.buffer.getRevision())
      expect(fixture.worker.document.lines).toHaveLength(4)
    } finally {
      fixture.dispose()
    }
  })

  it('keeps one frame in flight while ordered source and view changes accumulate', async () => {
    const fixture = createViewHarness('a\nb')
    try {
      await fixture.runtime.settle()
      fixture.worker.autoRender = false
      fixture.client.updateViewport({ ...fixture.snapshot().viewport, scrollTop: 20, scrollRow: 1 })
      await fixture.runtime.settle()
      const frames = fixture.worker.requests.filter((request) => request.type === 'render').length
      fixture.view.applyEdits([{ from: 1, to: 1, text: '\nx\ny' }])
      fixture.client.update(fixture.snapshot(), 'content')
      await fixture.runtime.settle()
      expect(fixture.worker.requests.filter((request) => request.type === 'render')).toHaveLength(
        frames,
      )
      fixture.worker.acknowledgeRender()
      await fixture.runtime.settle()
      expect(fixture.worker.requests.filter((request) => request.type === 'render')).toHaveLength(
        frames + 1,
      )
      const latest = fixture.worker.requests.findLast((request) => request.type === 'render')
      expect(latest?.source?.target.revision).toBe(fixture.buffer.getRevision())
    } finally {
      fixture.dispose()
    }
  })

  it('rejects a completion with the right view sequence and another source scope', async () => {
    const fixture = createViewHarness('one\ntwo')
    try {
      await fixture.runtime.settle()
      fixture.worker.autoRender = false
      fixture.client.updateViewport({ ...fixture.snapshot().viewport, scrollTop: 20, scrollRow: 1 })
      await fixture.runtime.settle()
      const frame = fixture.worker.requests.findLast((request) => request.type === 'render')
      if (!frame?.source) expect.unreachable('Correlated render is required')
      fixture.client.setExternalDecorations([])
      fixture.worker.send({
        type: 'rendered',
        sequence: frame.sequence,
        source: {
          ...frame.source,
          identity: {
            ...frame.source.identity,
            registrationId: frame.source.identity.registrationId + 1,
          },
        },
        sliderNeeded: false,
        sliderTop: 0,
        sliderHeight: 20,
        shadowVisible: false,
      })
      await fixture.runtime.settle()
      expect(fixture.worker.requests.findLast((request) => request.type === 'render')).toBe(frame)
      fixture.worker.acknowledgeRender()
      await fixture.runtime.settle()
      expect(fixture.worker.requests.findLast((request) => request.type === 'render')).not.toBe(
        frame,
      )
      fixture.client.dispose()
      fixture.worker.acknowledgeRender()
      expect(fixture.client.inspectWorker().lifecycle).toBe('disposed')
    } finally {
      fixture.dispose()
    }
  })
})
