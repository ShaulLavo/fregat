import { MinimapWorkerRenderer } from './renderer'
import { MinimapSourceProtocol } from './sourceProtocol'
import type { MinimapWorkerRequest, MinimapWorkerResponse } from './types'

const renderer = new MinimapWorkerRenderer()
const source = new MinimapSourceProtocol(renderer)

globalThis.onmessage = (event: MessageEvent<MinimapWorkerRequest>): void => {
  const request = event.data
  try {
    measureWorkerRequest(request, () => handleRequest(request))
  } catch (error) {
    post({ type: 'error', message: errorMessage(error) })
  }
}

function handleRequest(request: MinimapWorkerRequest): void {
  switch (request.type) {
    case 'init':
      renderer.init({
        mainCanvas: request.mainCanvas,
        decorationsCanvas: request.decorationsCanvas,
        options: request.options,
        styles: request.baseStyles,
      })
      return
    case 'updateBaseStyles':
      renderer.setBaseStyles(request.baseStyles)
      return
    case 'updateTokens':
      renderer.setTokens(request.tokens)
      return
    case 'updateTokenRange':
      renderer.updateTokenRange(request.patch)
      return
    case 'updateSelection':
      renderer.setSelections(request.selections)
      return
    case 'updateDecorations':
      renderer.setDecorations(request.decorations)
      return
    case 'updateExternalDecorations':
      renderer.setExternalDecorations(request.decorations)
      return
    case 'updateLayout': {
      const layout = renderer.updateLayout(request.metrics, request.viewport)
      if (layout) post({ type: 'layout', sequence: 0, layout })
      return
    }
    case 'updateViewport': {
      const layout = renderer.updateViewport(request.viewport)
      if (layout) post({ type: 'layout', sequence: 0, layout })
      return
    }
    case 'render':
      if (!source.accepts(request.source)) {
        post({ type: 'renderSkipped', sequence: request.sequence })
        return
      }
      postRender(request.sequence)
      return
    case 'projectSource':
      post({ type: 'sourceApplied', requestId: request.requestId, receipt: source.apply(request) })
      return
    case 'releaseSource':
      source.release(request.identity)
      return
  }
}

function postRender(sequence: number): void {
  const receipt = source.current()
  if (!receipt) return
  const result = renderer.render()
  if (!result) return

  post({
    type: 'rendered',
    sequence,
    source: receipt,
    sliderNeeded: result.sliderNeeded,
    sliderTop: result.sliderTop,
    sliderHeight: result.sliderHeight,
    shadowVisible: result.shadowVisible,
  })
}

function post(response: MinimapWorkerResponse): void {
  globalThis.postMessage(response)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

type MinimapWorkerDiagnostic = {
  readonly name: string
  readonly durationMs?: number
  readonly detail?: Readonly<Record<string, unknown>>
}

type MinimapWorkerDiagnosticSink =
  | ((diagnostic: MinimapWorkerDiagnostic) => void)
  | {
      readonly enabled?: boolean
      readonly record?: (diagnostic: MinimapWorkerDiagnostic) => void
    }

type MinimapWorkerDiagnosticGlobal = typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: MinimapWorkerDiagnosticSink | null
}

function measureWorkerRequest(request: MinimapWorkerRequest, run: () => void): void {
  const sink = minimapWorkerDiagnosticSink()
  if (!sink) {
    run()
    return
  }

  const start = nowMs()
  try {
    run()
  } finally {
    recordMinimapWorkerDiagnostic(sink, {
      name: 'minimap.worker.request',
      durationMs: nowMs() - start,
      detail: { request: request.type },
    })
  }
}

function minimapWorkerDiagnosticSink(): MinimapWorkerDiagnosticSink | null {
  const sink = minimapWorkerDiagnosticGlobal().__EDITOR_PERFORMANCE_DIAGNOSTICS__
  if (!sink) return null
  if (typeof sink === 'function') return sink
  if (sink.enabled !== true && typeof sink.record !== 'function') return null
  return sink
}

function recordMinimapWorkerDiagnostic(
  sink: MinimapWorkerDiagnosticSink,
  diagnostic: MinimapWorkerDiagnostic,
): void {
  if (typeof sink === 'function') {
    sink(diagnostic)
    return
  }

  sink.record?.(diagnostic)
}

function minimapWorkerDiagnosticGlobal(): MinimapWorkerDiagnosticGlobal {
  return globalThis as MinimapWorkerDiagnosticGlobal
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}
