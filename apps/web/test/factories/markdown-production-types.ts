import type { Observation } from '../../../../packages/markdown/test/qualification'

export type ProductionProcessedUpdate = {
  readonly revision: number
  readonly received: number
  readonly committed: number
}
export type ProductionTimingFrame = ProductionProcessedUpdate & { readonly painted: number }
export type ProductionTimingOptions = { readonly arrival?: 'paced' | 'burst-coalesced' }
export type ProductionMarkdownFrame = Observation & ProductionTimingFrame

export type ProductionTimingReceipt = {
  readonly processed: readonly ProductionProcessedUpdate[]
  readonly frames: readonly ProductionTimingFrame[]
  readonly final: ProductionTimingFrame
  readonly fullyReady: number
  readonly longTasks: readonly number[] | null
  readonly resources: readonly ProductionResourceTiming[]
}

export type ProductionMarkdownReceipt = {
  readonly frames: readonly ProductionMarkdownFrame[]
  readonly final: ProductionMarkdownFrame
  readonly longTasks: readonly number[] | null
  readonly resources: readonly ProductionResourceTiming[]
}

export type ProductionResourceTiming = {
  readonly name: string
  readonly duration: number
  readonly transferSize: number
  readonly decodedBodySize: number
}

export type ProductionResourceWindow = {
  readonly cycles: number
  readonly elapsedMs: number
  readonly parserWasmReservedBeforeBytes: number | null
  readonly parserWasmReservedAfterBytes: number | null
  readonly queryObserversBefore: number
  readonly queryObserversAfter: number
  readonly retainedMessageNodes: number
}

export type ProductionTimelineObservation = {
  readonly logicalMessages: number
  readonly renderedMessages: number
  readonly renderedRows: number
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
  readonly pinned: boolean
  readonly selectedText: string
  readonly composerText: string
}

type MarkdownProductionApi = {
  readonly ready: Promise<{ readonly engine: string; readonly initializationMs: number }>
  readonly run: (source: string, chunks: readonly string[]) => Promise<ProductionMarkdownReceipt>
  readonly time: (
    source: string,
    chunks: readonly string[],
    options?: ProductionTimingOptions,
  ) => Promise<ProductionTimingReceipt>
  readonly show: (source: string, live: boolean) => Promise<ProductionMarkdownFrame>
  readonly resources: (
    source: string,
    windows: readonly number[],
  ) => Promise<readonly ProductionResourceWindow[]>
  readonly mountTimeline: (count: number, source: string) => Promise<ProductionTimelineObservation>
  readonly updateTimeline: (source: string, live: boolean) => Promise<ProductionTimelineObservation>
  readonly dispose: () => Promise<void>
}

declare global {
  interface Window {
    markdownProductionProbe: MarkdownProductionApi
  }
}
