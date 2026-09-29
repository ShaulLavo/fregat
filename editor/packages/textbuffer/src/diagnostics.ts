/** A lazy, opt-in diagnostic bridge. The standalone buffer has no default sink. */
export type TextBufferDiagnosticSink = (
  name: 'sourceIndex',
  detail: () => Readonly<Record<string, unknown>>,
) => void

let diagnosticSink: TextBufferDiagnosticSink | undefined

export function setTextBufferDiagnosticSink(sink: TextBufferDiagnosticSink | undefined): void {
  diagnosticSink = sink
}

export function recordTextBufferDiagnostic(
  name: 'sourceIndex',
  detail: () => Readonly<Record<string, unknown>>,
): void {
  diagnosticSink?.(name, detail)
}
