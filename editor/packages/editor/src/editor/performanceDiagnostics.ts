import { setTextBufferDiagnosticSink } from '@singapore-editor/textbuffer/diagnostics'

type EditorPerformanceOperation = {
  readonly id: number
  readonly input: string
  readonly startedAtMs: number
}

type EditorPerformanceView = {
  readonly id: string
  readonly documentId: string | null
  readonly documentVersion: number
  readonly revision: number
}

type EditorPerformanceContext = {
  readonly operation?: EditorPerformanceOperation
  readonly view?: EditorPerformanceView
}

type EditorPerformanceScope = {
  readonly previous: EditorPerformanceContext | undefined
  readonly current: EditorPerformanceContext
}

type EditorPerformancePass = {
  readonly previous: EditorPerformancePass | null
  readonly operation: EditorPerformanceOperation | undefined
  phase: 'collecting' | 'flushing'
}

export type EditorPerformanceDiagnostic = {
  readonly timestampMs: number
  readonly operation?: EditorPerformanceOperation
  readonly view?: EditorPerformanceView
  readonly name: string
  readonly durationMs?: number
  readonly detail?: Readonly<Record<string, unknown>>
}

type EditorPerformanceDiagnosticSink =
  | ((diagnostic: EditorPerformanceDiagnostic) => void)
  | {
      readonly enabled?: boolean
      readonly record?: (diagnostic: EditorPerformanceDiagnostic) => void
    }

type EditorPerformanceDiagnosticGlobal = typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: EditorPerformanceDiagnosticSink | null
}

type DiagnosticDetail =
  | Readonly<Record<string, unknown>>
  | (() => Readonly<Record<string, unknown>> | undefined)
  | undefined

let activeContext: EditorPerformanceContext | undefined
let activePass: EditorPerformancePass | null = null
let nextOperationId = 0

export function beginEditorPerformanceBatch(): EditorPerformanceScope | null {
  const operation = activeContext?.operation
  if (operation && (activePass?.operation !== operation || activePass.phase === 'collecting'))
    return null
  return beginEditorPerformanceInput('editor.operation')
}

export function beginEditorPerformanceCommand(input: string): EditorPerformanceScope | null {
  if (
    activeContext?.operation &&
    activePass?.operation === activeContext.operation &&
    activePass.phase === 'collecting'
  )
    return null
  return beginEditorPerformanceInput(input)
}

export function beginEditorPerformancePass(): EditorPerformancePass | null {
  if (!editorPerformanceDiagnosticsEnabled()) return null
  // A participating view can flush while the owning batch is still collecting.
  if (activePass && activePass.operation === activeContext?.operation) return null

  activePass = { previous: activePass, operation: activeContext?.operation, phase: 'collecting' }
  return activePass
}

export function markEditorPerformanceFlush(pass: EditorPerformancePass | null): void {
  if (pass) pass.phase = 'flushing'
}

export function endEditorPerformancePass(pass: EditorPerformancePass | null): void {
  if (pass) activePass = pass.previous
}

export function beginEditorPerformanceInput(input: string): EditorPerformanceScope | null {
  if (!editorPerformanceDiagnosticsEnabled()) return null

  nextOperationId += 1
  return enterContext({ operation: { id: nextOperationId, input, startedAtMs: nowMs() } })
}

export function endEditorPerformanceInput(scope: EditorPerformanceScope | null): void {
  if (!scope) return

  const operation = scope.current.operation
  try {
    recordEditorPerformanceDiagnostic(
      'editor.input',
      undefined,
      operation ? nowMs() - operation.startedAtMs : undefined,
    )
  } finally {
    endEditorPerformanceScope(scope)
  }
}

export function traceEditorInput<TEvent, TResult>(
  input: string,
  run: (event: TEvent) => TResult,
): (event: TEvent) => TResult {
  return (event) => {
    const scope = beginEditorPerformanceInput(input)
    try {
      return run(event)
    } finally {
      endEditorPerformanceInput(scope)
    }
  }
}

export function beginEditorPerformanceView(
  id: string,
  documentId: string | null,
  documentVersion: number,
  revision: number,
): EditorPerformanceScope | null {
  if (!editorPerformanceDiagnosticsEnabled()) return null

  return enterContext({
    ...activeContext,
    view: { id, documentId, documentVersion, revision },
  })
}

export function endEditorPerformanceScope(scope: EditorPerformanceScope | null): void {
  if (scope) activeContext = scope.previous
}

// Only scalar identities cross the async boundary; this adds no snapshot ownership.
export function traceEditorPerformanceTask<TArgs extends unknown[], TResult>(
  name: string,
  run: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  if (!editorPerformanceDiagnosticsEnabled()) return run

  const context = activeContext
  return (...args) => runTracedTask(name, context, () => run(...args))
}

function runTracedTask<T>(
  name: string,
  context: EditorPerformanceContext | undefined,
  run: () => T,
): T {
  const previous = activeContext
  activeContext = context
  try {
    return measureEditorPerformance(name, run)
  } finally {
    activeContext = previous
  }
}

function enterContext(current: EditorPerformanceContext): EditorPerformanceScope {
  const scope = { previous: activeContext, current }
  activeContext = current
  return scope
}

export function measureEditorPerformance<T>(
  name: string,
  run: () => T,
  detail?: DiagnosticDetail,
): T {
  if (!editorPerformanceDiagnosticsEnabled()) return run()

  const start = nowMs()
  try {
    return run()
  } finally {
    recordEditorPerformanceDiagnostic(name, detail, nowMs() - start)
  }
}

export function recordEditorPerformanceDiagnostic(
  name: string,
  detail?: DiagnosticDetail,
  durationMs?: number,
): void {
  const sink = editorPerformanceDiagnosticSink()
  if (!sink) return

  const diagnostic = createDiagnostic(name, detail, durationMs)
  if (typeof sink === 'function') {
    sink(diagnostic)
    return
  }

  sink.record?.(diagnostic)
}

export function editorPerformanceDiagnosticsEnabled(): boolean {
  const sink = editorPerformanceDiagnosticGlobal().__EDITOR_PERFORMANCE_DIAGNOSTICS__
  if (!sink) return false
  if (typeof sink === 'function') return true
  return sink.enabled !== false && (sink.enabled === true || typeof sink.record === 'function')
}

function editorPerformanceDiagnosticSink(): EditorPerformanceDiagnosticSink | null {
  const sink = editorPerformanceDiagnosticGlobal().__EDITOR_PERFORMANCE_DIAGNOSTICS__
  if (!sink) return null
  if (typeof sink === 'function') return sink
  if (sink.enabled === false) return null
  if (sink.enabled !== true && typeof sink.record !== 'function') return null
  return sink
}

function createDiagnostic(
  name: string,
  detail: DiagnosticDetail,
  durationMs: number | undefined,
): EditorPerformanceDiagnostic {
  const resolvedDetail = resolveDiagnosticDetail(detail)
  return {
    name,
    timestampMs: nowMs(),
    ...activeContext,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(resolvedDetail === undefined ? {} : { detail: resolvedDetail }),
  }
}

function resolveDiagnosticDetail(
  detail: DiagnosticDetail,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof detail === 'function') return detail()
  return detail
}

function editorPerformanceDiagnosticGlobal(): EditorPerformanceDiagnosticGlobal {
  return globalThis as EditorPerformanceDiagnosticGlobal
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}

// Adapt storage diagnostics here; the storage package never imports editor modules.
setTextBufferDiagnosticSink((name, detail) => {
  recordEditorPerformanceDiagnostic('textSnapshot.' + name, detail)
})
