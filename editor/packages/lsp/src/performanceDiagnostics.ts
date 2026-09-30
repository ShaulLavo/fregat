type LspPerformanceDiagnostic = {
  readonly name: string
  readonly durationMs?: number
  readonly detail?: Readonly<Record<string, unknown>>
}

type LspPerformanceDiagnosticSink =
  | ((diagnostic: LspPerformanceDiagnostic) => void)
  | {
      readonly enabled?: boolean
      readonly record?: (diagnostic: LspPerformanceDiagnostic) => void
    }

type LspPerformanceDiagnosticGlobal = typeof globalThis & {
  __EDITOR_PERFORMANCE_DIAGNOSTICS__?: LspPerformanceDiagnosticSink | null
}

type DiagnosticDetail =
  | Readonly<Record<string, unknown>>
  | (() => Readonly<Record<string, unknown>> | undefined)
  | undefined

export function measureLspPerformance<T>(name: string, run: () => T, detail?: DiagnosticDetail): T {
  if (!lspPerformanceDiagnosticsEnabled()) return run()

  const start = nowMs()
  try {
    return run()
  } finally {
    recordLspPerformanceDiagnostic(name, detail, nowMs() - start)
  }
}

export function recordLspPerformanceDiagnostic(
  name: string,
  detail?: DiagnosticDetail,
  durationMs?: number,
): void {
  const sink = lspPerformanceDiagnosticSink()
  if (!sink) return

  const diagnostic = createDiagnostic(name, detail, durationMs)
  if (typeof sink === 'function') {
    sink(diagnostic)
    return
  }

  sink.record?.(diagnostic)
}

function lspPerformanceDiagnosticsEnabled(): boolean {
  const sink = lspPerformanceDiagnosticGlobal().__EDITOR_PERFORMANCE_DIAGNOSTICS__
  if (!sink) return false
  if (typeof sink === 'function') return true
  return sink.enabled === true || typeof sink.record === 'function'
}

function lspPerformanceDiagnosticSink(): LspPerformanceDiagnosticSink | null {
  const sink = lspPerformanceDiagnosticGlobal().__EDITOR_PERFORMANCE_DIAGNOSTICS__
  if (!sink) return null
  if (typeof sink === 'function') return sink
  if (sink.enabled !== true && typeof sink.record !== 'function') return null
  return sink
}

function createDiagnostic(
  name: string,
  detail: DiagnosticDetail,
  durationMs: number | undefined,
): LspPerformanceDiagnostic {
  const resolvedDetail = resolveDiagnosticDetail(detail)
  if (durationMs === undefined && resolvedDetail === undefined) return { name }
  if (durationMs === undefined) return { name, detail: resolvedDetail }
  if (resolvedDetail === undefined) return { name, durationMs }
  return { name, durationMs, detail: resolvedDetail }
}

function resolveDiagnosticDetail(
  detail: DiagnosticDetail,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof detail === 'function') return detail()
  return detail
}

function lspPerformanceDiagnosticGlobal(): LspPerformanceDiagnosticGlobal {
  return globalThis as LspPerformanceDiagnosticGlobal
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}
