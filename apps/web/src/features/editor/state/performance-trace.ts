import { clientLoggingEnabled } from '@/lib/client-logging'
import { createClientInvariantError } from '@/lib/structured-errors'

export type EditorOpenSampleTarget = {
  readonly path: string
  readonly rootPath: string
}

export type EditorOpenSampleResetRequest = EditorOpenSampleTarget & {
  readonly sampleId: string
}

export type EditorOpenSampleResetResult = {
  readonly evictions: number
  readonly joinedHighlighterRuntimeSessionIds: readonly string[]
  readonly joinedStructuralRuntimeSessionIds: readonly string[]
  readonly nonTargetIntents: number
  readonly preparedJoins: number
  readonly promotedBytes: number
  readonly highlighterRuntimeSessionIds: readonly string[]
  readonly quiescent: true
  readonly targetIntents: number
  readonly structuralRuntimeSessionIds: readonly string[]
  readonly wastedIntents: number
}

export type EditorOpenBenchmarkControl = {
  begin(request: EditorOpenSampleResetRequest): void
  prime(request: EditorOpenSampleTarget): Promise<{ readonly ready: true }>
  reset(request: EditorOpenSampleResetRequest): Promise<EditorOpenSampleResetResult>
}

const TRACE_PARAM = 'editorPerfTrace'
const DISABLE_PARAM = 'editorPerfDisable'
const LAYOUT_PARAM = 'editorPerfLayout'

export type EditorPerformanceLayoutVariant = 'absolute-rows' | 'default'

let disabledFeatureSet: ReadonlySet<string> | null = null
let editorOpenBenchmarkControl: EditorOpenBenchmarkControl | null = null

/** The active editor runtime registers its control on resume. */
export function registerEditorOpenBenchmarkControl(
  control: EditorOpenBenchmarkControl,
): () => void {
  editorOpenBenchmarkControl = control
  return () => {
    if (editorOpenBenchmarkControl === control) editorOpenBenchmarkControl = null
  }
}

export function editorPerformanceFeatureDisabled(feature: string): boolean {
  return editorPerformanceDisabledFeatures().has(feature)
}

export function editorPerformanceLayoutVariant(): EditorPerformanceLayoutVariant {
  if (typeof window === 'undefined') return 'default'

  const value = new URLSearchParams(window.location.search).get(LAYOUT_PARAM)
  return value === 'absolute-rows' ? 'absolute-rows' : 'default'
}

export function requireEditorOpenBenchmarkControl(): EditorOpenBenchmarkControl {
  if (editorOpenBenchmarkControl) return editorOpenBenchmarkControl

  throw createClientInvariantError('Editor-open benchmark control is unavailable')
}

export function editorPerformanceTraceEnabled(search: string): boolean {
  const value = new URLSearchParams(search).get(TRACE_PARAM)
  if (value === null) return false
  if (value === '') return true
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

export function editorPerformanceDisabledFeatures(): ReadonlySet<string> {
  if (disabledFeatureSet) return disabledFeatureSet
  if (typeof window === 'undefined') {
    disabledFeatureSet = new Set()
    return disabledFeatureSet
  }

  const params = new URLSearchParams(window.location.search)
  disabledFeatureSet = new Set(
    params
      .getAll(DISABLE_PARAM)
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean),
  )
  return disabledFeatureSet
}

export function editorPerformanceRecordingRequested(): boolean {
  if (typeof window === 'undefined' || !clientLoggingEnabled()) return false
  return (
    editorPerformanceTraceEnabled(window.location.search) ||
    editorPerformanceDisabledFeatures().size > 0
  )
}

export function installDisabledFeatureStyles(features: ReadonlySet<string>): void {
  if (typeof document === 'undefined') return
  if (features.size === 0) return

  document.documentElement.dataset.editorPerfDisable = Array.from(features).join(' ')
  if (document.getElementById('editor-performance-trace-styles')) return

  const style = document.createElement('style')
  style.id = 'editor-performance-trace-styles'
  style.textContent = [
    "[data-editor-perf-disable~='caret'] .editor-virtualized-caret-layer { animation: none !important; }",
    [
      "[data-editor-perf-disable~='text'] .editor-virtualized-row",
      "[data-editor-perf-disable~='text'] .editor-virtualized-fold-placeholder",
      "[data-editor-perf-disable~='text'] .editor-virtualized-hidden-character-marker",
    ].join(', ') + ' { color: transparent !important; }',
  ].join('\n')
  document.head.appendChild(style)
}
