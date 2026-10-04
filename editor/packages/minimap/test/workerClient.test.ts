import { documentRow } from './visibleRows'
import { createTestLineStartsView } from '@singapore-editor/core/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  createDocumentSession,
  createStringTextSnapshot,
  type TextSnapshot,
  type DocumentSessionChange,
  type TextEdit,
} from '@singapore-editor/core/document'
import type { EditorViewSnapshot } from '@singapore-editor/core/extensions'
import {
  EditorTokenStore,
  toEditorTokenStore,
  type EditorToken,
  type EditorTokenInput,
} from '@singapore-editor/core/syntax'
import { resolveMinimapOptions } from '../src/options'
import { MinimapWorkerRenderer } from '../src/renderer'
import { computeRenderLayout } from '../src/layout'
import { MinimapWorkerClient, type MinimapHost } from '../src/workerClient'
import type {
  MinimapDocumentPayload,
  MinimapWorkerRequest,
  MinimapWorkerResponse,
} from '../src/types'

describe('MinimapWorkerClient', () => {
  it('exposes worker lifecycle and terminates immediately on disposal', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot(),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!

      expect(client.inspectWorker()).toMatchObject({
        lifecycle: 'ready',
        lastError: null,
      })

      client.dispose()

      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(client.inspectWorker()).toMatchObject({
        lifecycle: 'disposed',
      })

      const postedRequests = worker.postMessage.mock.calls.length
      client.dispose()
      runtime.flushAnimationFrames()
      expect(worker.postMessage).toHaveBeenCalledTimes(postedRequests)
      expect(worker.terminate).toHaveBeenCalledTimes(1)

      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('reports disposal failures while completing client cleanup', async () => {
    const runtime = installMinimapRuntime()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const host = createHost()
    const client = new MinimapWorkerClient({
      host,
      options: resolveMinimapOptions(),
      snapshot: snapshot(),
      decorations: [],
      onLayoutWidth: vi.fn(),
      reservedLane: () => 0,
    })
    const worker = runtime.workers[0]!
    const failure = new DOMException('Worker termination failed')
    worker.terminate.mockImplementation(() => {
      throw failure
    })

    try {
      const postedRequests = worker.postMessage.mock.calls.length
      client.dispose()
      await Promise.resolve()
      runtime.flushAnimationFrames()
      client.dispose()
      expect(warn).toHaveBeenCalledExactlyOnceWith(failure.toString(), failure)
      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(worker.postMessage).toHaveBeenCalledTimes(postedRequests)
      expect(worker.onmessage).toBeNull()
      expect(worker.onerror).toBeNull()
      expect(client.inspectWorker()).toMatchObject({
        lifecycle: 'crashed',
        lastError: failure.message,
      })
    } finally {
      host.root.remove()
      host.colorScope.remove()
      warn.mockRestore()
      runtime.restore()
    }
  })

  it.each(['native', 'post'])(
    'reports the %s error and failed teardown during client disposal',
    async (mode) => {
      const runtime = installMinimapRuntime()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const host = createHost()
      const view = snapshot()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: view,
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      const failure = new DOMException('Worker termination failed')
      const original = new DOMException('Worker post failed', 'DataCloneError')
      worker.terminate.mockImplementation(() => {
        throw failure
      })
      worker.postMessage.mockImplementation(() => {
        throw original
      })

      try {
        expect(() => {
          if (mode === 'native') worker.fail('native failure')
          else client.updateViewport({ ...view.viewport, scrollTop: 20 })
        }).not.toThrow()
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0]![1].message).toBe(
          mode === 'native' ? 'Minimap worker crashed: native failure' : original.message,
        )
        const postedRequests = worker.postMessage.mock.calls.length
        client.dispose()
        await Promise.resolve()
        runtime.flushAnimationFrames()
        client.dispose()
        expect(warn).toHaveBeenCalledTimes(2)
        expect(warn).toHaveBeenLastCalledWith(failure.toString(), failure)
        expect(worker.terminate).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledTimes(postedRequests)
        expect(worker.onmessage).toBeNull()
        expect(worker.onerror).toBeNull()
        expect(client.inspectWorker()).toMatchObject({
          lifecycle: 'crashed',
          lastError: failure.message,
        })
      } finally {
        client.dispose()
        await Promise.resolve()
        host.root.remove()
        host.colorScope.remove()
        warn.mockRestore()
        runtime.restore()
      }
    },
  )

  it('records worker error responses on the owner error channel', () => {
    const runtime = installMinimapRuntime()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot(),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!

      worker.send({ type: 'error', message: 'render failed' })

      expect(client.inspectWorker()).toMatchObject({
        lastError: 'Minimap worker request failed: render failed',
        lifecycle: 'ready',
      })
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Code: minimap.WORKER_REQUEST_FAILED'),
        expect.objectContaining({
          code: 'minimap.WORKER_REQUEST_FAILED',
          why: 'render failed',
        }),
      )

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      warn.mockRestore()
      runtime.restore()
    }
  })

  it('records native worker failures and terminates the owner', () => {
    const runtime = installMinimapRuntime()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot(),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!

      worker.fail('worker crashed')

      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(client.inspectWorker()).toMatchObject({
        lastError: 'Minimap worker crashed: worker crashed',
        lifecycle: 'crashed',
      })
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Code: minimap.WORKER_CRASHED'),
        expect.objectContaining({
          code: 'minimap.WORKER_CRASHED',
          why: 'The browser reported: worker crashed',
        }),
      )

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      warn.mockRestore()
      runtime.restore()
    }
  })

  it('creates actionable native worker errors when the browser omits details', () => {
    const runtime = installMinimapRuntime()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot(),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!

      worker.fail('', { filename: 'http://localhost/minimap.worker.js', lineno: 12, colno: 8 })

      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(client.inspectWorker()).toMatchObject({
        lastError: 'Minimap worker crashed',
        lifecycle: 'crashed',
      })
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Fix: The editor keeps running without the minimap'),
        expect.objectContaining({
          code: 'minimap.WORKER_CRASHED',
          internal: expect.objectContaining({
            filename: 'http://localhost/minimap.worker.js',
            lineNumber: 12,
            columnNumber: 8,
          }),
        }),
      )

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      warn.mockRestore()
      runtime.restore()
    }
  })

  it('ignores rendered responses that arrive after disposal while work is in flight', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot(),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!

      runtime.flushAnimationFrames()
      const sequence = lastRenderSequence(worker)

      client.dispose()
      worker.send(renderedResponse(sequence))

      expect(host.slider.style.display).toBe('')
      expect(host.slider.style.transform).toBe('')
      expect(host.slider.style.height).toBe('')
      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(client.inspectWorker()).toMatchObject({
        lifecycle: 'disposed',
      })

      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('posts an initial render after the startup scheduler tick', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot(),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!

      expect(worker.postMessage.mock.calls.some((call) => call[0].type === 'render')).toBe(false)

      runtime.flushAnimationFrames()

      const render = worker.postMessage.mock.calls
        .map((call) => call[0] as MinimapWorkerRequest)
        .find((request): request is Extract<MinimapWorkerRequest, { type: 'render' }> => {
          return request.type === 'render'
        })

      expect(render?.sequence).toBeGreaterThan(0)
      expect(host.mainCanvas.style.height).toBe('100px')

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it.each([1, 1.25])(
    'matches the painted slider to the CSS canvas width at DPR %s across layout changes',
    (devicePixelRatio) => {
      const runtime = installMinimapRuntime()
      const host = createHost()
      const view = snapshot()
      host.root.style.width = '140px'
      host.slider.style.width = '100%'
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: view,
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 146,
      })

      try {
        const worker = runtime.workers[0]!
        for (const [clientWidth, maxColumn] of [
          [780, 120],
          [600, 120],
          [100, 4],
        ] as const) {
          const layout = computeRenderLayout({
            minimap: resolveMinimapOptions({ maxColumn }),
            metrics: { ...view.metrics, devicePixelRatio },
            viewport: {
              ...view.viewport,
              clientWidth,
              minimapHeight: view.viewport.clientHeight,
              reservedWidth: 0,
              visibleStart: view.viewport.visibleRange.start,
              visibleEnd: view.viewport.visibleRange.end,
            },
            lineCount: view.lineCount,
          })
          worker.send({ type: 'layout', sequence: 1, layout })

          expect(Number.parseFloat(host.sliderHorizontal.style.width)).toBeCloseTo(
            layout.canvasOuterWidth,
          )
          expect(Number.parseFloat(host.mainCanvas.style.width)).toBe(layout.canvasOuterWidth)
          expect(host.decorationsCanvas.style.width).toBe(host.mainCanvas.style.width)
          expect(host.root.style.width).toBe('140px')
          expect(host.slider.style.width).toBe('100%')
          expect(host.mainCanvas.width).toBe(300)
        }
      } finally {
        client.dispose()
        host.root.remove()
        host.colorScope.remove()
        runtime.restore()
      }
    },
  )

  it('opens documents through the secondary projection text snapshot', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const initialSnapshot = snapshotRejectingFlattening('line 1\nline 2\nline 3')
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: initialSnapshot,
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      const openDocument = worker.postMessage.mock.calls
        .map((call) => call[0] as MinimapWorkerRequest)
        .find((request): request is Extract<MinimapWorkerRequest, { type: 'openDocument' }> => {
          return request.type === 'openDocument'
        })

      expect('text' in (openDocument?.document ?? {})).toBe(false)
      expect(openDocument?.document.textLength).toBe(20)
      expect(openDocument?.document.lineStarts).toEqual([0, 7, 14])
      expect(openDocument?.document.lines).toEqual([
        { text: 'line 1', length: 6 },
        { text: 'line 2', length: 6 },
        { text: 'line 3', length: 6 },
      ])

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('clips open-document line summaries to the minimap column budget', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions({ maxColumn: 5 }),
        snapshot: snapshot({}, { text: 'abcdefghi\nshort' }),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      const openDocument = worker.postMessage.mock.calls
        .map((call) => call[0] as MinimapWorkerRequest)
        .find((request): request is Extract<MinimapWorkerRequest, { type: 'openDocument' }> => {
          return request.type === 'openDocument'
        })

      expect('text' in (openDocument?.document ?? {})).toBe(false)
      expect(openDocument?.document.textLength).toBe(15)
      expect(openDocument?.document.lines).toEqual([
        { text: 'abcde', length: 9 },
        { text: 'short', length: 5 },
      ])

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it.each([0, 100])(
    'uses the mounted content box with a %dpx reserved lane before viewport measurement',
    (reservedWidth) => {
      const runtime = installMinimapRuntime()
      try {
        const host = createHost()
        setElementBox(host.colorScope, { clientHeight: 320, clientWidth: 640 })
        host.root.style.height = '300px'
        const client = new MinimapWorkerClient({
          host,
          options: resolveMinimapOptions(),
          snapshot: snapshot({ clientHeight: 0, clientWidth: 0, scrollHeight: 0, scrollWidth: 0 }),
          decorations: [],
          onLayoutWidth: vi.fn(),
          reservedLane: () => reservedWidth,
        })
        const worker = runtime.workers[0]!
        const layoutRequest = worker.postMessage.mock.calls
          .map((call) => call[0] as MinimapWorkerRequest)
          .find((request): request is Extract<MinimapWorkerRequest, { type: 'updateLayout' }> => {
            return request.type === 'updateLayout'
          })

        runtime.flushAnimationFrames()

        expect(layoutRequest?.viewport).toMatchObject({
          clientHeight: 320,
          minimapHeight: 300,
          clientWidth: 640 - reservedWidth,
          scrollHeight: 320,
          scrollWidth: 640 - reservedWidth,
          reservedWidth,
        })
        expect(host.mainCanvas.style.height).toBe('300px')

        client.dispose()
        host.root.remove()
        host.colorScope.remove()
      } finally {
        runtime.restore()
      }
    },
  )

  it('skips layout updates for scroll-only viewport changes', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot({ scrollTop: 0 }),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      client.update(snapshot({ scrollTop: 125, visibleRange: { start: 6, end: 18 } }), 'viewport')
      runtime.flushAnimationFrames()

      const requests = worker.postMessage.mock.calls.map((call) => call[0] as { type: string })

      expect(requests.map((request) => request.type)).toEqual(['updateViewport', 'render'])
      expect(requests[0]).toEqual({
        type: 'updateViewport',
        viewport: expect.objectContaining({ scrollTop: 125, scrollRow: 6.25 }),
      })

      worker.postMessage.mockClear()
      client.updateViewport(
        snapshot({ scrollTop: 125, visibleRange: { start: 6, end: 18 } }).viewport,
      )
      expect(worker.postMessage).not.toHaveBeenCalled()

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('updates the worker layout when a full viewport update resizes the minimap lane', () => {
    const runtime = installMinimapRuntime()
    const host = createHost()
    const client = new MinimapWorkerClient({
      host,
      options: resolveMinimapOptions(),
      snapshot: snapshot(),
      decorations: [],
      onLayoutWidth: vi.fn(),
      reservedLane: () => 0,
    })
    try {
      const worker = runtime.workers[0]!
      runtime.flushTimers()
      worker.send(renderedResponse(lastRenderSequence(worker)))
      worker.postMessage.mockClear()
      host.root.style.height = '85px'

      client.update(snapshot({ clientHeight: 85 }), 'viewport')
      expect(worker.postMessage).toHaveBeenCalledWith({
        type: 'updateLayout',
        metrics: expect.any(Object),
        viewport: expect.objectContaining({ clientHeight: 85, minimapHeight: 85 }),
      })
    } finally {
      client.dispose()
      host.root.remove()
      host.colorScope.remove()
      runtime.restore()
    }
  })

  it('sends the latest viewport while token updates wait for a quiet period', () => {
    const runtime = installMinimapRuntime()
    const host = createHost()
    const client = new MinimapWorkerClient({
      host,
      options: resolveMinimapOptions(),
      snapshot: snapshot(),
      decorations: [],
      onLayoutWidth: vi.fn(),
      reservedLane: () => 0,
    })
    try {
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()
      const tokens = [{ start: 0, end: 6, style: { color: '#ff0000' } }]
      client.update(snapshot({}, { tokens }), 'tokens')
      client.update(snapshot({ scrollTop: 120 }, { tokens }), 'viewport')

      const requests = worker.postMessage.mock.calls.map((call) => call[0])
      expect(requests).toContainEqual({
        type: 'updateViewport',
        viewport: expect.objectContaining({ scrollTop: 120 }),
      })
      expect(requests.some((request) => request.type === 'updateTokenRange')).toBe(false)
      expect(requests.some((request) => request.type === 'updateTokens')).toBe(false)
    } finally {
      client.dispose()
      host.root.remove()
      host.colorScope.remove()
      runtime.restore()
    }
  })

  it('keeps layout stable for same-line edits that only change content width', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot(),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      const edit: TextEdit = { from: 6, to: 6, text: 'x' }
      client.update(
        snapshot({ scrollWidth: 168 }, { text: 'line 1x\nline 2\nline 3', contentWidth: 168 }),
        'content',
        documentEdit(edit, 'line 1x\nline 2\nline 3'),
      )
      runtime.flushAnimationFrames()

      const requests = worker.postMessage.mock.calls.map((call) => call[0] as { type: string })

      expect(requests.map((request) => request.type)).toEqual([
        'applyEdit',
        'updateViewport',
        'render',
      ])

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('keeps the latest viewport while an older worker frame finishes', () => {
    const runtime = installMinimapRuntime()
    const host = createHost()
    const client = new MinimapWorkerClient({
      host,
      options: resolveMinimapOptions(),
      snapshot: snapshot(),
      decorations: [],
      onLayoutWidth: vi.fn(),
      reservedLane: () => 0,
    })
    try {
      const worker = runtime.workers[0]!
      runtime.flushTimers()
      worker.send(renderedResponse(lastRenderSequence(worker)))
      client.updateViewport(snapshot({ scrollTop: 80 }).viewport)
      runtime.flushTimers()
      const sequence = lastRenderSequence(worker)
      worker.postMessage.mockClear()
      client.updateViewport(snapshot({ scrollTop: 160 }).viewport)
      const transform = host.slider.style.transform

      expect(worker.postMessage).toHaveBeenCalledWith({
        type: 'updateViewport',
        viewport: expect.objectContaining({ scrollTop: 160 }),
      })
      worker.send(renderedResponse(sequence))
      expect(host.slider.style.transform).toBe(transform)
      runtime.flushTimers()
      expect(lastRenderSequence(worker)).not.toBe(sequence)
    } finally {
      client.dispose()
      host.root.remove()
      host.colorScope.remove()
      runtime.restore()
    }
  })

  it('flushes ready token updates after a scrolling frame without restarting the delay', () => {
    const runtime = installMinimapRuntime()
    const host = createHost()
    const client = new MinimapWorkerClient({
      host,
      options: resolveMinimapOptions(),
      snapshot: snapshot(),
      decorations: [],
      onLayoutWidth: vi.fn(),
      reservedLane: () => 0,
    })
    try {
      const worker = runtime.workers[0]!
      runtime.flushTimers()
      worker.send(renderedResponse(lastRenderSequence(worker)))
      const tokens = [{ start: 0, end: 6, style: { color: '#ff0000' } }]
      client.update(snapshot({}, { tokens }), 'tokens')
      client.updateViewport(snapshot({ scrollTop: 120 }).viewport)
      runtime.flushTimers()
      const sequence = lastRenderSequence(worker)
      worker.postMessage.mockClear()

      worker.send(renderedResponse(sequence))

      const requests = worker.postMessage.mock.calls.map((call) => call[0])
      expect(requests.some((request) => request.type === 'updateTokenRange')).toBe(true)
      expect(host.slider.style.transform).toBe('translate3d(0, 0px, 0)')
    } finally {
      client.dispose()
      host.root.remove()
      host.colorScope.remove()
      runtime.restore()
    }
  })

  it('queues an expired burst deadline and publishes the latest ordered edits before render', () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const tasks: Array<() => void> = []
    const scheduler = Object.getOwnPropertyDescriptor(globalThis, 'scheduler')
    Object.defineProperty(globalThis, 'scheduler', {
      configurable: true,
      value: {
        postTask: (run: () => void) => {
          tasks.push(run)
          return Promise.resolve()
        },
      },
    })
    const fixture = createSummaryFixture(Array.from({ length: 20_000 }, () => 'line').join('\n'))
    while (tasks.length > 0) tasks.shift()?.()
    fixture.worker.postMessage.mockClear()
    const edits: TextEdit[] = []
    let publication: (() => void) | undefined
    try {
      for (const time of [0, 100, 200, 301, 302]) {
        now = time
        const from = fixture.session.getTextSnapshot().length
        const edit = { from, to: from, text: String(edits.length) }
        edits.push(edit)
        const change = fixture.session.applyEdits([edit])
        const before = tasks.length
        fixture.update(change)
        expect(fixture.worker.postMessage).not.toHaveBeenCalled()
        const queued = tasks.slice(before)
        expect(queued).toHaveLength(time === 301 ? 1 : 0)
        if (time === 301) publication = queued[0]
      }
      expect(publication).toBeTypeOf('function')
      while (tasks.length > 0) tasks.shift()?.()
      const requests = fixture.worker.postMessage.mock.calls.map((call) => call[0])
      expect(requests.map((request) => request.type)).toEqual([
        'applyEdits',
        'updateViewport',
        'render',
      ])
      expect(requests[0]).toEqual(
        expect.objectContaining({
          type: 'applyEdits',
          edits,
          document: expect.objectContaining({
            summaryPatch: expect.objectContaining({
              textLength: fixture.session.getTextSnapshot().length,
            }),
          }),
        }),
      )
      fixture.verify()
    } finally {
      fixture.dispose()
      restoreDescriptor(globalThis, 'scheduler', scheduler)
      clock.mockRestore()
    }
  })

  it('defers content worker updates while applying viewport feedback immediately', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot({ scrollTop: 0 }),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      const edit: TextEdit = { from: 6, to: 6, text: 'x' }
      client.update(
        snapshot(
          { scrollTop: 120, visibleRange: { start: 6, end: 18 } },
          { text: 'line 1x\nline 2\nline 3', visibleRows: [documentRow(2, 120)] },
        ),
        'content',
        documentEdit(edit, 'line 1x\nline 2\nline 3'),
      )

      expect(host.slider.style.transform).toBe('translate3d(0, 4px, 0)')
      runtime.flushFrames()
      expect(worker.postMessage).not.toHaveBeenCalled()

      runtime.flushTimers()
      runtime.flushFrames()

      const requests = worker.postMessage.mock.calls.map((call) => call[0] as { type: string })
      expect(requests.map((request) => request.type)).toEqual([
        'applyEdit',
        'updateViewport',
        'render',
      ])

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('keeps token payloads out of same-line edit updates', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot({}, { tokens: [{ start: 0, end: 6, style: { color: '#ff0000' } }] }),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      const edit: TextEdit = { from: 6, to: 6, text: 'x' }
      client.update(
        snapshot(
          { scrollWidth: 168 },
          {
            text: 'line 1x\nline 2\nline 3',
            contentWidth: 168,
            tokens: [{ start: 0, end: 7, style: { color: '#ff0000' } }],
          },
        ),
        'content',
        documentEdit(edit, 'line 1x\nline 2\nline 3'),
      )
      runtime.flushAnimationFrames()

      const applyEdit = worker.postMessage.mock.calls[0]?.[0] as Extract<
        MinimapWorkerRequest,
        { type: 'applyEdit' }
      >

      expect(applyEdit.type).toBe('applyEdit')
      expect('tokens' in applyEdit.document).toBe(false)
      expect(applyEdit.document.summaryPatch.lineStarts).toBeUndefined()
      expect(applyEdit.document.summaryPatch).toMatchObject({
        startLine: 0,
        deleteCount: 1,
        lines: [{ text: 'line 1x', length: 7 }],
      })

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('builds edit summary patches through the secondary projection text snapshot', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshotRejectingFlattening('line 1\nline 2\nline 3'),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      const edit: TextEdit = { from: 6, to: 6, text: 'x' }
      client.update(
        snapshotRejectingFlattening('line 1x\nline 2\nline 3'),
        'content',
        documentEdit(edit, 'line 1x\nline 2\nline 3'),
      )
      runtime.flushAnimationFrames()

      const applyEdit = worker.postMessage.mock.calls[0]?.[0] as Extract<
        MinimapWorkerRequest,
        { type: 'applyEdit' }
      >

      expect(applyEdit.type).toBe('applyEdit')
      expect('text' in applyEdit.document).toBe(false)
      expect(applyEdit.document.summaryPatch.lines).toEqual([{ text: 'line 1x', length: 7 }])

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('uses incremental updates for same-line deletions', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot({}, { text: 'abc' }),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      const edit: TextEdit = { from: 2, to: 3, text: '' }
      client.update(snapshot({}, { text: 'ab' }), 'content', documentEdit(edit, 'ab'))
      runtime.flushAnimationFrames()

      const requests = worker.postMessage.mock.calls.map((call) => call[0] as { type: string })

      expect(requests.map((request) => request.type)).toEqual([
        'applyEdit',
        'updateViewport',
        'render',
      ])

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('uses incremental updates for multi-line deletions', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot({}, { text: 'line 1\nline 2\nline 3' }),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      const edit: TextEdit = { from: 6, to: 7, text: '' }
      client.update(
        snapshot({}, { text: 'line 1line 2\nline 3' }),
        'content',
        documentEdit(edit, 'line 1line 2\nline 3'),
      )
      runtime.flushAnimationFrames()

      const requests = worker.postMessage.mock.calls.map((call) => call[0] as { type: string })

      expect(requests.map((request) => request.type)).toEqual([
        'applyEdit',
        'updateLayout',
        'render',
      ])

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('includes the touched old line when building multi-line paste summary patches', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot({}, { text: 'a\nb' }),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      const edit: TextEdit = { from: 2, to: 2, text: 'x\ny\n' }
      client.update(
        snapshot({}, { text: 'a\nx\ny\nb' }),
        'content',
        documentEdit(edit, 'a\nx\ny\nb'),
      )
      runtime.flushAnimationFrames()

      const applyEdit = worker.postMessage.mock.calls[0]?.[0] as Extract<
        MinimapWorkerRequest,
        { type: 'applyEdit' }
      >

      expect(applyEdit.type).toBe('applyEdit')
      expect(applyEdit.document.summaryPatch).toMatchObject({
        startLine: 1,
        deleteCount: 1,
        lines: [
          { text: 'x', length: 1 },
          { text: 'y', length: 1 },
          { text: 'b', length: 1 },
        ],
      })

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it.each([
    { lineCount: 16, inserted: 'x', distinct: false },
    { lineCount: 500_000, inserted: 'x', distinct: false },
    { lineCount: 16, inserted: 'x\ny\n', distinct: false },
    { lineCount: 500_000, inserted: 'x\ny\n', distinct: false },
    { lineCount: 16, inserted: 'x', distinct: true },
    { lineCount: 16, inserted: 'x\ny\n', distinct: true },
  ])(
    'keeps summaries aligned through coalesced undo and redo (%j)',
    ({ lineCount, inserted, distinct }) => {
      const runtime = installMinimapRuntime()
      const host = createHost()
      const text = Array.from({ length: lineCount }, (_, index) =>
        distinct ? `//${index}` : '//',
      ).join('\n')
      const session = createDocumentSession(text)
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot({}, { text }),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      const { renderer, initial } = createSummaryRenderer(worker)

      try {
        worker.send(renderedResponse(1))
        worker.postMessage.mockClear()

        for (let index = 0; index < 12; index += 1) {
          const offset = 24 + index * inserted.length
          const change = session.applyEdits([{ from: offset, to: offset, text: inserted }])
          client.update(snapshot({}, { textSnapshot: change.textSnapshot }), 'content', change)
        }
        runtime.flushAnimationFrames()
        applyPostedSummaryUpdates(renderer, worker)
        const edited = rendererSummary(renderer)
        expect(edited.lines.length).toBe(session.getTextSnapshot().lineCount)
        expect(edited.lines).toEqual(
          session
            .materializeFullText()
            .split('\n')
            .map((line) => ({ text: line, length: line.length })),
        )
        worker.send(renderedResponse(lastRenderSequence(worker)))
        worker.postMessage.mockClear()

        for (let index = 0; index < 12; index += 1) {
          const change = session.undo()
          client.update(snapshot({}, { textSnapshot: change.textSnapshot }), 'content', change)
        }
        expect(session.materializeFullText()).toBe(text)
        runtime.flushAnimationFrames()
        applyPostedSummaryUpdates(renderer, worker)

        const restored = rendererSummary(renderer)
        expect(restored.lines.length).toBe(lineCount)
        expect(restored.lines).toEqual(initial.lines)
        expect(restored.lineStarts).toEqual(initial.lineStarts)
        expect(restored.textLength).toBe(initial.textLength)
        worker.send(renderedResponse(lastRenderSequence(worker)))
        worker.postMessage.mockClear()

        for (let index = 0; index < 12; index += 1) {
          const change = session.redo()
          client.update(snapshot({}, { textSnapshot: change.textSnapshot }), 'content', change)
        }
        runtime.flushAnimationFrames()
        applyPostedSummaryUpdates(renderer, worker)

        const redone = rendererSummary(renderer)
        expect(redone.lines.length).toBe(session.getTextSnapshot().lineCount)
        expect(redone.lines).toEqual(edited.lines)
        expect(redone.lineStarts).toEqual(edited.lineStarts)
        expect(redone.textLength).toBe(edited.textLength)
      } finally {
        client.dispose()
        renderer.dispose()
        host.root.remove()
        host.colorScope.remove()
        runtime.restore()
      }
    },
  )

  it.each(['selection', 'layout', 'viewport'] as const)(
    'keeps the worker source baseline when %s arrives before content',
    (kind) => {
      const source = Array.from({ length: 64 }, (_, index) => `//${index}😀`).join('\n')
      const fixture = createSummaryFixture(source)
      try {
        for (let index = 0; index < 12; index += 1) {
          const offset = 24 + index * 4
          const change = fixture.session.applyEdits([{ from: offset, to: offset, text: 'x\ny\n' }])
          if (index === 0) fixture.notify(kind)
          fixture.update(change)
        }
        fixture.verify()
        for (let index = 0; index < 12; index += 1) {
          const change = fixture.session.undo()
          if (index === 0) fixture.notify(kind)
          fixture.update(change)
        }
        expect(fixture.session.materializeFullText()).toBe(source)
        fixture.verify()
        for (let index = 0; index < 12; index += 1) {
          const change = fixture.session.redo()
          if (index === 0) fixture.notify(kind)
          fixture.update(change)
        }
        fixture.verify()
      } finally {
        fixture.dispose()
      }
    },
  )

  it.each(['edit', 'undo', 'redo'] as const)(
    'tracks cancelling offsets through queued %s',
    (operation) => {
      const fixture = createSummaryFixture('AAAAAAAAAA\nZ\nC')
      const edits: readonly TextEdit[] = [
        { from: 1, to: 10, text: '' },
        { from: 2, to: 3, text: 'B' },
        { from: 1, to: 1, text: 'AAAAAAAAA' },
      ]
      try {
        for (const edit of edits) {
          fixture.update(fixture.session.applyEdits([edit]))
          if (operation !== 'edit') fixture.verify()
        }
        if (operation === 'edit') {
          fixture.verify()
          return
        }
        for (let index = 0; index < edits.length; index += 1) {
          fixture.update(fixture.session.undo())
          if (operation === 'redo') fixture.verify()
        }
        if (operation === 'undo') {
          fixture.verify()
          return
        }
        for (let index = 0; index < edits.length; index += 1) {
          fixture.update(fixture.session.redo())
        }
        fixture.verify()
      } finally {
        fixture.dispose()
      }
    },
  )

  it.each(Array.from({ length: 80 }, (_, index) => index + 1))(
    'matches fresh summaries after mixed edits, undo and redo with seed %d',
    (seed) => {
      const fixtures = ['', 'AAAAAAAAAA\nZ\nC', 'one\ntwo\nthree\n', '😀\né\n中']
      const fixture = createSummaryFixture(fixtures[seed % fixtures.length]!)
      const randomIndex = seededIndex(seed)
      try {
        for (let round = 0; round < 12; round += 1) {
          runSummaryRound(fixture, round % 2 === 0, randomIndex)
        }
      } finally {
        fixture.dispose()
      }
    },
  )

  it('queues incremental edits while a render is in flight', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot(),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      const firstEdit: TextEdit = { from: 6, to: 6, text: 'x' }
      client.update(
        snapshot({}, { text: 'line 1x\nline 2\nline 3' }),
        'content',
        documentEdit(firstEdit, 'line 1x\nline 2\nline 3'),
      )
      runtime.flushAnimationFrames()
      const inFlightSequence = lastRenderSequence(worker)
      worker.postMessage.mockClear()

      const secondEdit: TextEdit = { from: 7, to: 7, text: 'y' }
      const thirdEdit: TextEdit = { from: 8, to: 8, text: 'z' }
      client.update(
        snapshot({}, { text: 'line 1xy\nline 2\nline 3' }),
        'content',
        documentEdit(secondEdit, 'line 1xy\nline 2\nline 3'),
      )
      client.update(
        snapshot({}, { text: 'line 1xyz\nline 2\nline 3' }),
        'content',
        documentEdit(thirdEdit, 'line 1xyz\nline 2\nline 3'),
      )
      runtime.flushAnimationFrames()

      expect(worker.postMessage).not.toHaveBeenCalled()

      worker.send(renderedResponse(inFlightSequence))
      runtime.flushAnimationFrames()

      const requests = worker.postMessage.mock.calls.map((call) => call[0] as MinimapWorkerRequest)
      const applyEdits = requests[0] as Extract<MinimapWorkerRequest, { type: 'applyEdits' }>

      expect(requests.map((request) => request.type)).toEqual([
        'applyEdits',
        'updateViewport',
        'render',
      ])
      expect(applyEdits.edits).toEqual([secondEdit, thirdEdit])
      expect(applyEdits.document.summaryPatch).toMatchObject({
        startLine: 0,
        deleteCount: 1,
        lines: [{ text: 'line 1xyz', length: 9 }],
      })

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('coalesces rapid same-line edits into one summary patch before flushing', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshotRejectingFlattening('line 1\nline 2\nline 3'),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      client.update(
        snapshotRejectingFlattening('line 1x\nline 2\nline 3'),
        'content',
        documentEdit({ from: 6, to: 6, text: 'x' }, 'line 1x\nline 2\nline 3'),
      )
      client.update(
        snapshotRejectingFlattening('line 1xy\nline 2\nline 3'),
        'content',
        documentEdit({ from: 7, to: 7, text: 'y' }, 'line 1xy\nline 2\nline 3'),
      )
      runtime.flushFrames()

      expect(worker.postMessage).not.toHaveBeenCalled()

      runtime.flushTimers()
      runtime.flushFrames()

      const requests = worker.postMessage.mock.calls.map((call) => call[0] as MinimapWorkerRequest)
      const applyEdits = requests[0] as Extract<MinimapWorkerRequest, { type: 'applyEdits' }>

      expect(requests.map((request) => request.type)).toEqual([
        'applyEdits',
        'updateViewport',
        'render',
      ])
      expect(applyEdits.edits).toEqual([
        { from: 6, to: 6, text: 'x' },
        { from: 7, to: 7, text: 'y' },
      ])
      expect('text' in applyEdits.document).toBe(false)
      expect(applyEdits.document.summaryPatch).toMatchObject({
        startLine: 0,
        deleteCount: 1,
        lines: [{ text: 'line 1xy', length: 8 }],
      })

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('uses incremental updates for batched same-line edits', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot({}, { text: 'abc def ghi' }),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      const edits: readonly TextEdit[] = [
        { from: 0, to: 0, text: 'x' },
        { from: 4, to: 4, text: 'y' },
      ]
      client.update(
        snapshot({}, { text: 'xabc ydef ghi' }),
        'content',
        documentEdits(edits, 'xabc ydef ghi'),
      )
      runtime.flushAnimationFrames()

      const requests = worker.postMessage.mock.calls.map((call) => call[0] as MinimapWorkerRequest)
      const applyEdits = requests[0] as Extract<MinimapWorkerRequest, { type: 'applyEdits' }>

      expect(requests.map((request) => request.type)).toEqual([
        'applyEdits',
        'updateViewport',
        'render',
      ])
      expect(applyEdits.edits).toEqual([
        { from: 0, to: 0, text: 'x' },
        { from: 5, to: 5, text: 'y' },
      ])
      expect(applyEdits.document.summaryPatch).toMatchObject({
        startLine: 0,
        deleteCount: 1,
        lines: [{ text: 'xabc ydef ghi', length: 13 }],
      })

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('coalesces pending content edits with token range patches', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot(
          {},
          {
            tokens: [
              { start: 0, end: 6, style: { color: '#ff0000' } },
              { start: 7, end: 13, style: { color: '#00ff00' } },
            ],
          },
        ),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      const projectedTokens = [
        { start: 0, end: 7, style: { color: '#ff0000' } },
        { start: 8, end: 14, style: { color: '#00ff00' } },
      ]
      const refreshedTokens = [
        projectedTokens[0]!,
        { start: 8, end: 14, style: { color: '#0000ff' } },
      ]
      const edit: TextEdit = { from: 6, to: 6, text: 'x' }
      client.update(
        snapshot({}, { text: 'line 1x\nline 2\nline 3', tokens: projectedTokens }),
        'content',
        documentEdit(edit, 'line 1x\nline 2\nline 3'),
      )
      client.update(
        snapshot({}, { text: 'line 1x\nline 2\nline 3', tokens: refreshedTokens }),
        'tokens',
      )
      runtime.flushAnimationFrames()

      const requests = worker.postMessage.mock.calls.map((call) => call[0] as MinimapWorkerRequest)
      const applyEdit = requests[0] as Extract<MinimapWorkerRequest, { type: 'applyEdit' }>
      const tokenPatch = requests[1] as Extract<MinimapWorkerRequest, { type: 'updateTokenRange' }>

      expect(requests.map((request) => request.type)).toEqual([
        'applyEdit',
        'updateTokenRange',
        'updateViewport',
        'render',
      ])
      expect('tokens' in applyEdit.document).toBe(false)
      expect(applyEdit.document.summaryPatch.lines).toEqual([{ text: 'line 1x', length: 7 }])
      expect(tokenPatch.patch).toMatchObject({
        start: 1,
        deleteCount: 1,
        tokens: [{ start: 8, end: 14 }],
      })

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('keeps the current scroll position when external markers change', () => {
    const runtime = installMinimapRuntime()
    const host = createHost()
    const initial = snapshot()
    const client = new MinimapWorkerClient({
      host,
      options: resolveMinimapOptions(),
      snapshot: initial,
      decorations: [],
      onLayoutWidth: vi.fn(),
      reservedLane: () => 0,
    })
    try {
      const worker = runtime.workers[0]!
      runtime.flushTimers()
      worker.send(renderedResponse(lastRenderSequence(worker)))
      client.updateViewport(snapshot({ scrollTop: 125 }).viewport)
      const transform = host.slider.style.transform

      client.setExternalDecorations([])
      expect(host.slider.style.transform).toBe(transform)
      runtime.flushTimers()
      worker.send(renderedResponse(lastRenderSequence(worker)))
      expect(host.slider.style.transform).toBe(transform)
    } finally {
      client.dispose()
      host.root.remove()
      host.colorScope.remove()
      runtime.restore()
    }
  })

  it('sends external decoration updates without a full decoration payload', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot(),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      const decoration = {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
        color: '#ff0000',
        position: 'inline' as const,
      }
      client.setExternalDecorations([decoration])
      runtime.flushAnimationFrames()

      const requests = worker.postMessage.mock.calls.map((call) => call[0] as MinimapWorkerRequest)

      expect(requests.map((request) => request.type)).toEqual([
        'updateExternalDecorations',
        'render',
      ])
      expect(requests[0]).toMatchObject({
        type: 'updateExternalDecorations',
        decorations: [decoration],
      })

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('sends token range patches after incremental edit token refreshes', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot(
          {},
          {
            tokens: [
              { start: 0, end: 6, style: { color: '#ff0000' } },
              { start: 7, end: 11, style: { color: '#00ff00' } },
              { start: 12, end: 18, style: { color: '#0000ff' } },
            ],
          },
        ),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      const edit: TextEdit = { from: 6, to: 6, text: 'x' }
      const projectedTokens = [
        { start: 0, end: 7, style: { color: '#ff0000' } },
        { start: 8, end: 12, style: { color: '#00ff00' } },
        { start: 13, end: 19, style: { color: '#0000ff' } },
      ]
      client.update(
        snapshot({}, { text: 'line 1x\nline 2\nline 3', tokens: projectedTokens }),
        'content',
        documentEdit(edit, 'line 1x\nline 2\nline 3'),
      )
      runtime.flushAnimationFrames()
      worker.send(renderedResponse(lastRenderSequence(worker)))
      worker.postMessage.mockClear()

      client.update(
        snapshot(
          {},
          {
            text: 'line 1x\nline 2\nline 3',
            tokens: [
              projectedTokens[0]!,
              { start: 8, end: 12, style: { color: '#ffffff' } },
              projectedTokens[2]!,
            ],
          },
        ),
        'tokens',
      )
      runtime.flushAnimationFrames()

      const requests = worker.postMessage.mock.calls.map((call) => call[0] as MinimapWorkerRequest)
      const tokenPatch = requests[0] as Extract<MinimapWorkerRequest, { type: 'updateTokenRange' }>

      expect(requests.map((request) => request.type)).toEqual(['updateTokenRange', 'render'])
      expect(tokenPatch.patch).toMatchObject({
        start: 1,
        deleteCount: 1,
        tokens: [{ start: 8, end: 12 }],
      })

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })

  it('posts the token patch an element-wise diff would after a one-line edit', () => {
    const runtime = installMinimapRuntime()
    try {
      const host = createHost()
      const lines = Array.from({ length: 400 }, (_, index) => `line ${index}`)
      const text = lines.join('\n')
      const starts = lineStarts(text)
      const original = EditorTokenStore.fromTokens(
        lines.flatMap((line, index) => [
          { start: starts[index]!, end: starts[index]! + 4, style: PATCH_STYLES[index % 3]! },
          { start: starts[index]! + 5, end: starts[index]! + line.length, style: PATCH_STYLES[2]! },
        ]),
      )
      const client = new MinimapWorkerClient({
        host,
        options: resolveMinimapOptions(),
        snapshot: snapshot({}, { text: text, tokens: original }),
        decorations: [],
        onLayoutWidth: vi.fn(),
        reservedLane: () => 0,
      })
      const worker = runtime.workers[0]!
      const opened = worker.postMessage.mock.calls
        .map((call) => call[0] as MinimapWorkerRequest)
        .find((request) => request.type === 'openDocument')
      const openedTokens = opened?.type === 'openDocument' ? opened.document.tokens : []
      worker.send(renderedResponse(1))
      worker.postMessage.mockClear()

      // Derived the way the editor derives them, so the stores share every untouched segment.
      const editedLine = 200
      const lineStart = starts[editedLine]!
      const lineEnd = lineStart + lines[editedLine]!.length
      const first = editedLine * 2
      // `fromTokens` numbers styles in the order it meets them, so ids come from the palette.
      const [red, green, blue] = PATCH_STYLES.map((style) => original.styles.indexOf(style))
      const italic = { color: PATCH_STYLES[1]!.color, fontStyle: 'italic' as const }
      const projected = original.replaceRange(
        first,
        first + 2,
        tokenRun([
          [lineStart, lineStart + 4, blue!],
          [lineStart + 5, lineEnd + 1, blue!],
        ]),
        { delta: 1, keepsLiveRanges: true },
      )
      const refreshed = projected.replaceRange(
        first,
        first + 2,
        tokenRun([
          [lineStart, lineStart + 4, red!],
          [lineStart + 5, lineEnd, original.styles.length],
          [lineEnd, lineEnd + 1, green!],
        ]),
        { delta: 0, keepsLiveRanges: null, styles: [...original.styles, italic] },
      )
      const editedText = `${text.slice(0, lineEnd)}x${text.slice(lineEnd)}`
      client.update(
        snapshot({}, { text: editedText, tokens: projected }),
        'content',
        documentEdit({ from: lineEnd, to: lineEnd, text: 'x' }, editedText),
      )
      runtime.flushAnimationFrames()
      worker.send(renderedResponse(lastRenderSequence(worker)))
      worker.postMessage.mockClear()

      client.update(snapshot({}, { text: editedText, tokens: refreshed }), 'tokens')
      runtime.flushAnimationFrames()

      const requests = worker.postMessage.mock.calls.map((call) => call[0] as MinimapWorkerRequest)
      const tokenPatch = requests[0] as Extract<MinimapWorkerRequest, { type: 'updateTokenRange' }>
      const expected = elementWiseTokenPatch(projected.toTokens(), refreshed.toTokens())
      const colors = new Map(
        original.toTokens().map((token, index) => [token.style.color, openedTokens[index]?.color]),
      )

      expect(requests.map((request) => request.type)).toEqual(['updateTokenRange', 'render'])
      expect(expected.tokens).toHaveLength(3)
      expect(tokenPatch.patch).toEqual({
        start: expected.start,
        deleteCount: expected.deleteCount,
        tokens: expected.tokens.map((token) => ({
          start: token.start,
          end: token.end,
          color: colors.get(token.style.color),
        })),
      })

      client.dispose()
      host.root.remove()
      host.colorScope.remove()
    } finally {
      runtime.restore()
    }
  })
})

const PATCH_STYLES = [{ color: '#ff0000' }, { color: '#00ff00' }, { color: '#0000ff' }]

function tokenRun(tokens: readonly (readonly [start: number, end: number, styleId: number])[]): {
  readonly starts: Uint32Array
  readonly ends: Uint32Array
  readonly styleIds: Uint32Array
} {
  return {
    starts: Uint32Array.from(tokens, ([start]) => start),
    ends: Uint32Array.from(tokens, ([, end]) => end),
    styleIds: Uint32Array.from(tokens, ([, , styleId]) => styleId),
  }
}

/** The diff of two object-token lists: common prefix, then common suffix, the rest replaced. */
function elementWiseTokenPatch(
  previous: readonly EditorToken[],
  next: readonly EditorToken[],
): {
  readonly start: number
  readonly deleteCount: number
  readonly tokens: readonly EditorToken[]
} {
  let start = 0
  while (start < previous.length && start < next.length) {
    if (!sameToken(previous[start]!, next[start]!)) break
    start += 1
  }

  let previousEnd = previous.length
  let nextEnd = next.length
  while (previousEnd > start && nextEnd > start) {
    if (!sameToken(previous[previousEnd - 1]!, next[nextEnd - 1]!)) break
    previousEnd -= 1
    nextEnd -= 1
  }
  return { start, deleteCount: previousEnd - start, tokens: next.slice(start, nextEnd) }
}

function sameToken(left: EditorToken, right: EditorToken): boolean {
  if (left.start !== right.start || left.end !== right.end) return false
  return (
    left.style.color === right.style.color &&
    left.style.backgroundColor === right.style.backgroundColor &&
    left.style.fontStyle === right.style.fontStyle &&
    left.style.fontWeight === right.style.fontWeight &&
    left.style.textDecoration === right.style.textDecoration
  )
}

function createHost(): MinimapHost {
  const root = document.createElement('div')
  const colorScope = document.createElement('div')
  const shadow = document.createElement('div')
  const mainCanvas = document.createElement('canvas')
  const decorationsCanvas = document.createElement('canvas')
  const slider = document.createElement('div')
  const sliderHorizontal = document.createElement('div')
  colorScope.style.color = 'rgb(212, 212, 212)'
  colorScope.style.backgroundColor = 'rgb(30, 30, 30)'
  slider.appendChild(sliderHorizontal)
  root.append(shadow, mainCanvas, decorationsCanvas, slider)
  document.body.append(colorScope, root)
  return { root, colorScope, shadow, mainCanvas, decorationsCanvas, slider, sliderHorizontal }
}

function setElementBox(
  element: HTMLElement,
  box: { readonly clientHeight: number; readonly clientWidth: number },
): void {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: box.clientHeight })
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: box.clientWidth })
}

function snapshot(
  viewport: Partial<EditorViewSnapshot['viewport']> = {},
  overrides: Partial<Pick<EditorViewSnapshot, 'contentWidth' | 'visibleRows'>> & {
    readonly text?: string
    readonly textSnapshot?: TextSnapshot
    readonly tokens?: EditorTokenInput
  } = {},
): EditorViewSnapshot {
  const textSnapshot =
    overrides.textSnapshot ?? createStringTextSnapshot(overrides.text ?? 'line 1\nline 2\nline 3')
  const lineStartsView = createTestLineStartsView(textSnapshot)
  const contentWidth = overrides.contentWidth ?? 160
  return {
    documentId: 'minimap-test',
    languageId: 'typescript',
    textSnapshot,
    lineStartsView,
    textVersion: 1,
    initialHighlightStatus: 'painted',
    syntaxStatus: 'ready',
    paintLayers: [],
    documentSyncPoint: {
      revision: 1,
      segment: Object.freeze({}) as EditorViewSnapshot['documentSyncPoint']['segment'],
      textVersion: 1,
    },
    changesSinceDocumentSyncPoint: () => null,
    get lineStarts() {
      return lineStartsView.toArray()
    },
    tokens: toEditorTokenStore(overrides.tokens ?? []),
    brackets: [],
    selections: [],
    metrics: { rowHeight: 20, characterWidth: 8 },
    lineCount: textSnapshot.lineCount,
    contentWidth,
    totalHeight: 60,
    gutterWidth: 0,
    gutterLayout: { leadingInset: 0, fixedWidth: 0, lanes: [] },
    tabSize: 4,
    foldMarkers: [],
    visibleRows: overrides.visibleRows ?? [],
    viewport: {
      scrollTop: 0,
      scrollRow: (viewport.scrollTop ?? 0) / 20,
      scrollLeft: 0,
      scrollHeight: 400,
      scrollWidth: contentWidth,
      clientHeight: 100,
      clientWidth: 240,
      borderBoxHeight: 100,
      borderBoxWidth: 240,
      visibleRange: { start: 0, end: 3 },
      ...viewport,
    },
    toVisibleSnapshot() {
      return null
    },
  }
}

// Calibrated against the source, not a getter: any whole-document read throws.
function snapshotRejectingFlattening(text: string): EditorViewSnapshot {
  const source = createStringTextSnapshot(text)
  const flattened = () => {
    throw new Error('the document should not be flattened')
  }
  const textSnapshot: TextSnapshot = {
    get length() {
      return source.length
    },
    get lineCount() {
      return source.lineCount
    },
    lineStart: (row) => source.lineStart(row),
    lineRange: (row) => source.lineRange(row),
    lineAt: (offset) => source.lineAt(offset),
    readRange: (start, end) =>
      start === 0 && end === source.length ? flattened() : source.readRange(start, end),
    forEachTextChunk: flattened,
    materializeFullText: flattened,
  }
  return { ...snapshot({}, { text }), textSnapshot }
}

function documentEdit(edit: TextEdit, _fullText: string): DocumentSessionChange {
  return documentEdits([edit])
}

function documentEdits(edits: readonly TextEdit[], _fullText?: string): DocumentSessionChange {
  return { kind: 'edit', edits } as unknown as DocumentSessionChange
}

function lineStarts(text: string): readonly number[] {
  const starts = [0]
  let index = text.indexOf('\n')
  while (index !== -1) {
    starts.push(index + 1)
    index = text.indexOf('\n', index + 1)
  }
  return starts
}

function createSummaryFixture(text: string) {
  const runtime = installMinimapRuntime()
  const host = createHost()
  const session = createDocumentSession(text)
  const client = new MinimapWorkerClient({
    host,
    options: resolveMinimapOptions(),
    snapshot: snapshot({}, { textSnapshot: session.getTextSnapshot() }),
    decorations: [],
    onLayoutWidth: vi.fn(),
    reservedLane: () => 0,
  })
  const worker = runtime.workers[0]!
  const { renderer } = createSummaryRenderer(worker)
  worker.send(renderedResponse(1))
  worker.postMessage.mockClear()

  return {
    session,
    worker,
    notify(kind: 'selection' | 'layout' | 'viewport') {
      client.update(snapshot({}, { textSnapshot: session.getTextSnapshot() }), kind)
      runtime.flushAnimationFrames()
      worker.send(renderedResponse(lastRenderSequence(worker)))
    },
    update(change: DocumentSessionChange) {
      client.update(snapshot({}, { textSnapshot: change.textSnapshot }), 'content', change)
    },
    verify() {
      runtime.flushAnimationFrames()
      applyPostedSummaryUpdates(renderer, worker)
      const actual = rendererSummary(renderer)
      const expected = freshSummary(session.getTextSnapshot(), runtime)
      expect(actual.lines.length).toBe(session.getTextSnapshot().lineCount)
      expect(actual.lines).toEqual(expected.lines)
      expect(actual.lineStarts).toEqual(expected.lineStarts)
      expect(actual.textLength).toBe(expected.textLength)
      worker.send(renderedResponse(lastRenderSequence(worker)))
      worker.postMessage.mockClear()
    },
    dispose() {
      client.dispose()
      renderer.dispose()
      host.root.remove()
      host.colorScope.remove()
      runtime.restore()
    },
  }
}

function createSummaryRenderer(worker: MockWorker) {
  const requests = worker.postMessage.mock.calls.map((call) => call[0] as MinimapWorkerRequest)
  const init = requests.find((request) => request.type === 'init')
  const initial = requests.find((request) => request.type === 'openDocument')
  if (!init || !initial) throw new Error('Expected initialized minimap summaries')
  const canvas = { getContext: () => ({}) } as unknown as OffscreenCanvas
  const renderer = new MinimapWorkerRenderer()
  renderer.init({
    mainCanvas: canvas,
    decorationsCanvas: canvas,
    options: resolveMinimapOptions(),
    styles: init.baseStyles,
  })
  renderer.setDocument(initial.document)
  return { renderer, initial: initial.document }
}

function freshSummary(
  textSnapshot: TextSnapshot,
  runtime: ReturnType<typeof installMinimapRuntime>,
): MinimapDocumentPayload {
  const host = createHost()
  const client = new MinimapWorkerClient({
    host,
    options: resolveMinimapOptions(),
    snapshot: snapshot({}, { textSnapshot }),
    decorations: [],
    onLayoutWidth: vi.fn(),
    reservedLane: () => 0,
  })
  const worker = runtime.workers.at(-1)!
  try {
    const request = worker.postMessage.mock.calls
      .map((call) => call[0] as MinimapWorkerRequest)
      .find((item) => item.type === 'openDocument')
    if (!request) throw new Error('Expected fresh summaries')
    return request.document
  } finally {
    client.dispose()
    host.root.remove()
    host.colorScope.remove()
  }
}

function runSummaryRound(
  fixture: ReturnType<typeof createSummaryFixture>,
  queued: boolean,
  randomIndex: (length: number) => number,
): void {
  const count = randomIndex(4) + 1
  let undoCount = 0
  for (let index = 0; index < count; index += 1) {
    const edit = randomSummaryEdit(fixture.session.getTextSnapshot().length, randomIndex)
    const change = fixture.session.applyEdits([edit])
    if (change.kind === 'edit') undoCount += 1
    fixture.update(change)
    if (!queued) fixture.verify()
  }
  if (queued) fixture.verify()
  for (let index = 0; index < undoCount; index += 1) {
    fixture.update(fixture.session.undo())
    if (!queued) fixture.verify()
  }
  if (queued && undoCount > 0) fixture.verify()
  for (let index = 0; index < undoCount; index += 1) {
    fixture.update(fixture.session.redo())
    if (!queued) fixture.verify()
  }
  if (queued && undoCount > 0) fixture.verify()
}

function seededIndex(seed: number): (length: number) => number {
  let state = seed
  return (length) => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) % length
  }
}

function randomSummaryEdit(length: number, randomIndex: (length: number) => number): TextEdit {
  const operation = randomIndex(3)
  const first = randomIndex(length + 1)
  const second = operation === 0 ? first : randomIndex(length + 1)
  const from = Math.min(first, second)
  const to = Math.max(first, second)
  const texts = ['x', 'q', '中', '😀', 'é', '\n', 'x\ny\n', '\r\n', '']
  const text = operation === 1 ? '' : texts[randomIndex(texts.length)]!
  return { from, to, text }
}

function applyPostedSummaryUpdates(renderer: MinimapWorkerRenderer, worker: MockWorker): void {
  for (const [request] of worker.postMessage.mock.calls as [MinimapWorkerRequest][]) {
    if (request.type === 'openDocument' || request.type === 'replaceDocument')
      renderer.setDocument(request.document)
    if (request.type === 'applyEdit') renderer.applyEdit(request.edit, request.document)
    if (request.type === 'applyEdits') renderer.applyEdits(request.edits, request.document)
  }
}

function rendererSummary(renderer: MinimapWorkerRenderer): MinimapDocumentPayload {
  const state = (renderer as unknown as { state: { document: MinimapDocumentPayload } | null })
    .state
  if (!state) throw new Error('Expected initialized renderer')
  return state.document
}

function renderedResponse(sequence: number): MinimapWorkerResponse {
  return {
    type: 'rendered',
    sequence,
    sliderNeeded: true,
    sliderTop: 0,
    sliderHeight: 20,
    shadowVisible: false,
  }
}

function lastRenderSequence(worker: MockWorker): number {
  const request = worker.postMessage.mock.calls
    .map((call) => call[0] as MinimapWorkerRequest)
    .findLast((item): item is Extract<MinimapWorkerRequest, { type: 'render' }> => {
      return item.type === 'render'
    })
  if (!request) throw new Error('Expected a render request')
  return request.sequence
}

function installMinimapRuntime(): {
  readonly workers: MockWorker[]
  readonly flushFrames: () => void
  readonly flushTimers: () => void
  readonly flushAnimationFrames: () => void
  readonly restore: () => void
} {
  const workers: MockWorker[] = []
  const frames: (() => void)[] = []
  const worker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  const offscreenCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas')
  const requestAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  const cancelAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
  const setTimeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout')
  const clearTimeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout')
  const requestIdleCallback = Object.getOwnPropertyDescriptor(globalThis, 'requestIdleCallback')
  const cancelIdleCallback = Object.getOwnPropertyDescriptor(globalThis, 'cancelIdleCallback')
  const transferControlToOffscreen = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    'transferControlToOffscreen',
  )
  const timers = new Map<number, () => void>()
  let nextTimer = 1

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: class extends MockWorker {
      public constructor(url: URL, options?: WorkerOptions) {
        super(url, options)
        workers.push(this)
      }
    },
  })
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    configurable: true,
    value: class MockOffscreenCanvas {},
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: () => void) => {
      frames.push(callback)
      return frames.length
    },
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    value: (callback: () => void) => {
      const timer = nextTimer
      nextTimer += 1
      timers.set(timer, callback)
      return timer
    },
  })
  Object.defineProperty(globalThis, 'clearTimeout', {
    configurable: true,
    value: (timer: number) => {
      timers.delete(timer)
    },
  })
  Object.defineProperty(globalThis, 'requestIdleCallback', {
    configurable: true,
    value: undefined,
  })
  Object.defineProperty(globalThis, 'cancelIdleCallback', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
    configurable: true,
    value: () => ({}),
  })

  const flushTimerQueue = () => {
    while (timers.size > 0) {
      for (const [timer, callback] of Array.from(timers)) {
        timers.delete(timer)
        callback()
      }
    }
  }

  return {
    workers,
    flushFrames: () => {
      for (const frame of frames.splice(0)) frame()
    },
    flushTimers: flushTimerQueue,
    flushAnimationFrames: () => {
      flushTimerQueue()
      for (const frame of frames.splice(0)) frame()
    },
    restore: () => {
      restoreDescriptor(globalThis, 'Worker', worker)
      restoreDescriptor(globalThis, 'OffscreenCanvas', offscreenCanvas)
      restoreDescriptor(globalThis, 'requestAnimationFrame', requestAnimationFrame)
      restoreDescriptor(globalThis, 'cancelAnimationFrame', cancelAnimationFrame)
      restoreDescriptor(globalThis, 'setTimeout', setTimeoutDescriptor)
      restoreDescriptor(globalThis, 'clearTimeout', clearTimeoutDescriptor)
      restoreDescriptor(globalThis, 'requestIdleCallback', requestIdleCallback)
      restoreDescriptor(globalThis, 'cancelIdleCallback', cancelIdleCallback)
      restoreDescriptor(
        HTMLCanvasElement.prototype,
        'transferControlToOffscreen',
        transferControlToOffscreen,
      )
    },
  }
}

class MockWorker {
  public onmessage: ((event: MessageEvent<MinimapWorkerResponse>) => void) | null = null
  public onerror: ((event: ErrorEvent) => void) | null = null
  public postMessage = vi.fn()
  public terminate = vi.fn()

  public constructor(_url: URL, _options?: WorkerOptions) {}

  public send(response: MinimapWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<MinimapWorkerResponse>)
  }

  public fail(message: string, init: Partial<ErrorEvent> = {}): void {
    this.onerror?.({
      colno: init.colno ?? 0,
      error: init.error,
      filename: init.filename ?? '',
      lineno: init.lineno ?? 0,
      message,
    } as ErrorEvent)
  }
}

function restoreDescriptor(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor)
    return
  }

  Reflect.deleteProperty(target, property)
}
