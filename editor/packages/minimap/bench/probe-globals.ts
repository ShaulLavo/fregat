import type { MinimapBenchBridge } from './browser.ts'
import type { EditorPerformanceDiagnostic } from '../../editor/src/editor/performanceDiagnostics.ts'
export type ClockSample = { roundTripMs: number; workerOffsetMs: number }
export type WireEvent = {
  direction: 'send' | 'receive'
  at: number
  type?: string
  id?: number
  durationMs?: number
  scrollTop?: number
  sequence?: number
  [key: string]: unknown
}
export type HandledEvent = {
  phase: 'handled'
  type: string
  id?: number
  sequence?: number
  scrollTop?: number
  at: number
  durationMs: number
  paints: number
  rasterUploads: number
  canvasCopies: number
}
export type DiagnosticEvent = Pick<
  EditorPerformanceDiagnostic,
  'name' | 'durationMs' | 'detail'
> & { phase: 'diagnostic'; id?: number; at: number }
export type WorkerEvent = HandledEvent | DiagnosticEvent
export type Clock = { workerOffsetMs: number; uncertaintyMs: number; samples: ClockSample[] }
export type Scenario = {
  name: string
  minimap: boolean
  tokenEvery: number
  stepPx: number
  steps: number
  trial: number
}
export type Sample = Scenario &
  Awaited<ReturnType<MinimapBenchBridge['run']>> & {
    wire: WireEvent[]
    workerEvents: WorkerEvent[]
    clock: Clock | null
  }
export type Capture = { data: string; timestamp: number }
declare global {
  var __EDITOR_PERFORMANCE_DIAGNOSTICS__:
    | ((diagnostic: Pick<EditorPerformanceDiagnostic, 'name' | 'durationMs' | 'detail'>) => void)
    | {
        enabled?: boolean
        record?: (
          diagnostic: Pick<EditorPerformanceDiagnostic, 'name' | 'durationMs' | 'detail'>,
        ) => void
      }
    | null
    | undefined
  var __minimapBench: MinimapBenchBridge
  var __minimapWire: WireEvent[]
  var __minimapWorker: WorkerEvent[]
  var __minimapClockPing: () => Promise<ClockSample>
}
