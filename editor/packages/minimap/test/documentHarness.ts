import { createEditorBufferSession, createEditorTextBuffer } from '@singapore-editor/core/document'
import {
  createEditorDocumentAnalysis,
  type EditorDocumentAnalysis,
} from '@singapore-editor/core/editor'
import { createTestLineStartsView } from '@singapore-editor/core/testing'
import { EditorTokenStore } from '@singapore-editor/core/syntax'
import type { EditorViewSnapshot } from '@singapore-editor/core/extensions'
import { vi } from 'vitest'
import { retainMinimapDocumentSource } from '../src/documentSource'
import { MinimapWorkerClient, type MinimapHost } from '../src/workerClient'
import { resolveMinimapOptions } from '../src/options'
import { applyTextEditsToMinimapDocument } from '../src/renderer'
import type {
  MinimapDocumentPayload,
  MinimapWorkerRequest,
  MinimapWorkerResponse,
} from '../src/types'

export function installDocumentWorker() {
  const frames = new Map<number, FrameRequestCallback>()
  const timers = new Map<number, () => void>()
  let sequence = 0
  const workers: ProjectionWorker[] = []
  vi.stubGlobal(
    'Worker',
    class extends ProjectionWorker {
      public constructor() {
        super()
        workers.push(this)
      }
    },
  )
  vi.stubGlobal('OffscreenCanvas', class {})
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
    frames.set(++sequence, run)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('setTimeout', (run: () => void) => {
    timers.set(++sequence, run)
    return sequence
  })
  vi.stubGlobal('clearTimeout', (id: number) => timers.delete(id))
  vi.stubGlobal('requestIdleCallback', undefined)
  vi.stubGlobal('cancelIdleCallback', undefined)
  const transfer = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    'transferControlToOffscreen',
  )
  Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
    configurable: true,
    value: () => new OffscreenCanvas(100, 100),
  })
  return {
    workers,
    async settle() {
      for (let pass = 0; pass < 40; pass++) {
        const pendingTimers = new Map(timers)
        timers.clear()
        for (const run of pendingTimers.values()) run()
        const pendingFrames = new Map(frames)
        frames.clear()
        for (const run of pendingFrames.values()) run(performance.now())
        await Promise.resolve()
      }
    },
    restore() {
      vi.unstubAllGlobals()
      if (transfer)
        Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', transfer)
      else Reflect.deleteProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen')
    },
  }
}

export function createDocumentHarness(text: string) {
  const runtime = installDocumentWorker()
  const buffer = createEditorTextBuffer(text)
  const view = createEditorBufferSession(buffer)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'minimap-test' })
  const retained = retainMinimapDocumentSource(analysis.contributions, {
    maxColumn: 16,
    onMessage: () => {},
  })
  if (!retained) throw new TypeError('Document contribution is required')
  const worker = runtime.workers[0]
  if (!worker) throw new TypeError('Projection worker is required')
  return {
    runtime,
    buffer,
    view,
    analysis,
    worker,
    retained,
    async current() {
      const requested = retained.lease.request()
      await runtime.settle()
      return await requested
    },
    dispose() {
      retained.lease.dispose()
      analysis.dispose()
      runtime.restore()
    },
  }
}

export function viewSnapshot(
  analysis: EditorDocumentAnalysis,
  overrides: Partial<EditorViewSnapshot> = {},
): EditorViewSnapshot {
  const textSnapshot = analysis.buffer.getTextSnapshot()
  const point = analysis.buffer.getDocumentSyncPoint()
  const lineStartsView = createTestLineStartsView(textSnapshot)
  return {
    documentId: analysis.documentId,
    languageId: 'typescript',
    textSnapshot,
    lineStartsView,
    textVersion: point.textVersion,
    documentSyncPoint: point,
    changesSinceDocumentSyncPoint: (base, edits) =>
      analysis.buffer.changesSinceDocumentSyncPoint(base, edits),
    initialHighlightStatus: 'painted',
    syntaxStatus: 'ready',
    paintLayers: [],
    get lineStarts() {
      return lineStartsView.toArray()
    },
    tokens: EditorTokenStore.fromTokens([]),
    brackets: [],
    selections: [],
    metrics: { rowHeight: 20, characterWidth: 8 },
    lineCount: textSnapshot.lineCount,
    contentWidth: 160,
    totalHeight: textSnapshot.lineCount * 20,
    gutterWidth: 0,
    gutterLayout: { leadingInset: 0, fixedWidth: 0, lanes: [] },
    tabSize: 4,
    foldMarkers: [],
    visibleRows: [],
    viewport: {
      scrollTop: 0,
      scrollRow: 0,
      scrollLeft: 0,
      scrollHeight: textSnapshot.lineCount * 20,
      scrollWidth: 160,
      clientHeight: 100,
      clientWidth: 240,
      borderBoxHeight: 100,
      borderBoxWidth: 240,
      visibleRange: { start: 0, end: Math.min(5, textSnapshot.lineCount) },
    },
    toVisibleSnapshot: () => null,
    ...overrides,
  }
}

export function createViewHarness(text: string) {
  const runtime = installDocumentWorker()
  const buffer = createEditorTextBuffer(text)
  const view = createEditorBufferSession(buffer)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'minimap-view' })
  const host = minimapHost()
  const onLayoutWidth = vi.fn()
  const client = new MinimapWorkerClient({
    host,
    options: resolveMinimapOptions({ maxColumn: 16 }),
    snapshot: viewSnapshot(analysis),
    decorations: [],
    onLayoutWidth,
    reservedLane: () => 0,
    contributions: analysis.contributions,
  })
  const worker = runtime.workers[0]
  if (!worker) throw new TypeError('View worker is required')
  return {
    runtime,
    buffer,
    view,
    analysis,
    host,
    client,
    worker,
    onLayoutWidth,
    snapshot: (overrides?: Partial<EditorViewSnapshot>) => viewSnapshot(analysis, overrides),
    dispose() {
      client.dispose()
      analysis.dispose()
      host.root.remove()
      host.colorScope.remove()
      runtime.restore()
    },
  }
}

export function minimapHost(): MinimapHost {
  const root = document.createElement('div')
  const colorScope = document.createElement('div')
  colorScope.style.color = 'rgb(212, 212, 212)'
  colorScope.style.backgroundColor = 'rgb(30, 30, 30)'
  const host = {
    root,
    colorScope,
    mainCanvas: document.createElement('canvas'),
    decorationsCanvas: document.createElement('canvas'),
    slider: document.createElement('div'),
    sliderHorizontal: document.createElement('div'),
    shadow: document.createElement('div'),
  }
  root.append(host.mainCanvas, host.decorationsCanvas, host.slider, host.shadow)
  host.slider.append(host.sliderHorizontal)
  document.body.append(colorScope, root)
  return host
}

export class ProjectionWorker {
  public autoSource = true
  public autoRender = true
  public onmessage: ((event: MessageEvent<MinimapWorkerResponse>) => void) | null = null
  public onerror: ((event: ErrorEvent) => void) | null = null
  public readonly requests: MinimapWorkerRequest[] = []
  public readonly terminate = vi.fn()
  public document: MinimapDocumentPayload = {
    textLength: 0,
    lineStarts: [0],
    lines: [{ text: '', length: 0 }],
    tokens: [],
    selections: [],
    decorations: [],
  }
  private receipt: Extract<MinimapWorkerResponse, { type: 'sourceApplied' }>['receipt'] | null =
    null

  public readonly postMessage = vi.fn((request: MinimapWorkerRequest) => {
    this.requests.push(request)
    if (request.type === 'projectSource') {
      this.applyProjection(request)
      return
    }
    if (request.type === 'render') this.render(request)
    if (request.type === 'updateTokens')
      this.document = { ...this.document, tokens: request.tokens }
    if (request.type === 'updateTokenRange')
      this.document = {
        ...this.document,
        tokens: this.document.tokens.toSpliced(
          request.patch.start,
          request.patch.deleteCount,
          ...request.patch.tokens,
        ),
      }
    if (request.type === 'updateSelection')
      this.document = { ...this.document, selections: request.selections }
    if (request.type === 'updateExternalDecorations')
      this.document = { ...this.document, decorations: request.decorations }
  })

  public send(response: MinimapWorkerResponse): void {
    this.onmessage?.(new MessageEvent('message', { data: response }))
  }

  public acknowledgeSource(): void {
    const request = this.requests.findLast((request) => request.type === 'projectSource')
    if (!request) throw new TypeError('A projected source request is required')
    this.send({
      type: 'sourceApplied',
      requestId: request.requestId,
      receipt: {
        kind: 'applied',
        identity: request.identity,
        base: request.base,
        target: request.target,
      },
    })
  }

  public acknowledgeRender(): void {
    const request = this.requests.findLast((request) => request.type === 'render')
    if (!request) throw new TypeError('A render request is required')
    this.send({
      type: 'rendered',
      sequence: request.sequence,
      source: request.source,
      sliderNeeded: false,
      sliderTop: 0,
      sliderHeight: 20,
      shadowVisible: false,
    })
  }

  private applyProjection(request: Extract<MinimapWorkerRequest, { type: 'projectSource' }>): void {
    const projection = request.projection
    this.document =
      projection.kind === 'reset'
        ? { ...projection.summary, tokens: [], selections: [], decorations: [] }
        : {
            ...this.document,
            ...applyTextEditsToMinimapDocument(this.document, projection.edits, projection.summary),
          }
    this.receipt = {
      kind: 'applied',
      identity: request.identity,
      base: request.base,
      target: request.target,
    }
    const receipt = this.receipt
    if (this.autoSource)
      queueMicrotask(() =>
        this.send({ type: 'sourceApplied', requestId: request.requestId, receipt }),
      )
  }

  private render(request: Extract<MinimapWorkerRequest, { type: 'render' }>): void {
    if (!this.autoRender) return
    const source = this.receipt
    if (!source) throw new TypeError('Source admission is required for a frame')
    queueMicrotask(() =>
      this.send({
        type: 'rendered',
        sequence: request.sequence,
        source,
        sliderNeeded: false,
        sliderTop: 0,
        sliderHeight: 20,
        shadowVisible: false,
      }),
    )
  }
}
