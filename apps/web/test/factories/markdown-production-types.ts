import type { Observation } from '../../../../packages/markdown/test/qualification'

export type ProductionOutputReceipt = {
  readonly digest: string
  readonly textBytes: number
  readonly elementCount: number
}

export type ProductionProcessedUpdate = {
  readonly revision: number
  readonly inputSha256: string
  readonly inputUtf16Units: number
  readonly live: boolean
  readonly scheduled: number
  readonly received: number
  readonly committed: number
  readonly output: ProductionOutputReceipt
  readonly parseCalls: number
  readonly parserWallMs: number
}
export type ProductionTimingFrame = ProductionProcessedUpdate & {
  readonly observedRevision: number
  readonly painted: number
  readonly paintedOutput: ProductionOutputReceipt
}
export type ProductionMismatchSample = {
  readonly actual: ProductionMarkdownFrame
  readonly expectedIndex: number
  readonly expected: ProductionOutputReceipt
}
export type ProductionMismatchSink = (sample: ProductionMismatchSample) => Promise<void>

export type ProductionTimingOptions = {
  readonly onMismatch?: ProductionMismatchSink
  readonly arrival: 'paced' | 'burst-coalesced'
  readonly arrivalOffsetsMs: readonly number[]
  readonly expected: readonly ProductionOutputReceipt[]
  readonly heldSyntax?: {
    readonly held: string
    readonly released: string
  }
}
export type ProductionMarkdownFrame = Observation & ProductionTimingFrame

type ProductionHeldSyntaxReceipt = {
  readonly held: ProductionTimingFrame
  readonly released: ProductionTimingFrame
  readonly holdMs: number
}

export type ProductionTimingReceipt = {
  readonly started: number
  readonly ended: number
  readonly processed: readonly ProductionProcessedUpdate[]
  readonly skippedPaintRevisions: readonly number[]
  readonly frames: readonly ProductionTimingFrame[]
  readonly final: ProductionTimingFrame
  readonly fullyReady: number
  readonly fullyReadyOutput: ProductionOutputReceipt
  readonly heldSyntax: ProductionHeldSyntaxReceipt | null
  readonly longTasks: readonly number[] | null
  readonly resources: readonly ProductionResourceTiming[]
}

export type ProductionMarkdownReceipt = {
  readonly frames: readonly ProductionMarkdownFrame[]
  readonly final: ProductionMarkdownFrame
  readonly fullyReady: number
  readonly longTasks: readonly number[] | null
  readonly resources: readonly ProductionResourceTiming[]
}

export type ProductionResourceKind = 'host' | 'grammar' | 'resolver' | 'javascript' | 'other'

export type ProductionResourceTiming = {
  readonly name: string
  readonly kind: ProductionResourceKind
  readonly initiatorType: string
  readonly startTime: number
  readonly duration: number
  readonly transferSize: number
  readonly decodedBodySize: number
}

export type ProductionResourceControlWindow = {
  readonly cycles: number
  readonly elapsedMs: number
  readonly jsHeapUsedBeforeBytes: number | null
  readonly jsHeapUsedAfterBytes: number | null
  readonly backingStorageBeforeBytes: number | null
  readonly backingStorageAfterBytes: number | null
}

export type ProductionResourceWindow = {
  readonly cycles: number
  readonly elapsedMs: number
  readonly parserWasmReservedBeforeBytes: number | null
  readonly parserWasmReservedAfterBytes: number | null
  readonly jsHeapUsedBeforeBytes: number | null
  readonly jsHeapUsedAfterBytes: number | null
  readonly jsHeapReservedBeforeBytes: number | null
  readonly jsHeapReservedAfterBytes: number | null
  readonly backingStorageBeforeBytes: number | null
  readonly backingStorageAfterBytes: number | null
  readonly queryObserversBefore: number
  readonly queryObserversAfter: number
  readonly retainedMessageNodes: number
  readonly simultaneousMessages: number
  readonly peakWasmReservedBytes: number | null
  readonly peakMessageNodes: number
}

export type ProductionTimelineObservation = {
  readonly revision: number
  readonly sourceSha256: string
  readonly parserCalls: number
  readonly renderedTailText: string
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

export type ProductionTimelineReceipt = {
  readonly mounted: ProductionTimelineObservation
  readonly streamed: ProductionTimelineObservation
  readonly streamRevisions: readonly ProductionTimelineObservation[]
  readonly typed: ProductionTimelineObservation
  readonly selected: ProductionTimelineObservation
  readonly scrolled: ProductionTimelineObservation
  readonly timelineReadyPaintMs: number
  readonly inputToPaintMs: number
  readonly selectionToPaintMs: number
  readonly scrollToPaintMs: number
  readonly scrollDriftPx: number
  readonly inputSamples: readonly {
    received: number
    painted: number
    key: string
    textBefore: string
    paintedText: string
  }[]
  readonly frameIntervalsMs: readonly number[]
  readonly followDistancePx: number
  readonly parkApplicable: boolean
  readonly longTasks: readonly number[] | null
}

export type ProductionOracleSink = (
  record:
    | { readonly kind: 'frame'; readonly frame: ProductionMarkdownFrame }
    | {
        readonly kind: 'final'
        readonly frame: ProductionMarkdownFrame
        readonly fullyReady: number
        readonly longTasks: ProductionMarkdownReceipt['longTasks']
        readonly resources: ProductionMarkdownReceipt['resources']
      }
    | { readonly kind: 'fresh'; readonly frame: ProductionMarkdownFrame },
) => Promise<void>

type MarkdownProductionApi = {
  readonly ready: Promise<{
    readonly engine: string
    readonly initializationMs: number
  }>
  readonly run: (source: string, chunks: readonly string[]) => Promise<ProductionMarkdownReceipt>
  readonly streamOracle: (
    source: string,
    chunks: readonly string[],
    sink: ProductionOracleSink,
  ) => Promise<void>
  readonly time: (
    source: string,
    chunks: readonly string[],
    options: ProductionTimingOptions,
  ) => Promise<ProductionTimingReceipt>
  readonly show: (source: string, live: boolean) => Promise<ProductionMarkdownFrame>
  readonly resources: (
    source: string | null,
    windows: readonly number[],
    simultaneousMessages?: number,
  ) => Promise<readonly ProductionResourceWindow[]>
  readonly mountTimeline: (count: number, source: string) => Promise<ProductionTimelineObservation>
  readonly updateTimeline: (source: string, live: boolean) => Promise<ProductionTimelineObservation>
  readonly observeTimeline: () => ProductionTimelineObservation
  readonly activity: () => {
    readonly longTasks: readonly number[] | null
    readonly frameIntervalsMs: readonly number[]
  }
  readonly dispose: () => Promise<void>
}

declare global {
  interface Window {
    markdownProductionProbe: MarkdownProductionApi
    markdownOracleFrame: ProductionOracleSink
    markdownMismatchFrame: ProductionMismatchSink
  }
}
