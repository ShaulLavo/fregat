import type { TextReadSnapshot } from '@singapore-editor/core/document'

import type { DiagnosticPeekModel } from '@/features/editor/state/diagnostic-peek-source'
import { diagnosticTargetForUri } from '@/lib/diagnostic'
import type { DiagnosticFixRequest } from '@/lib/diagnostic-ai/utils/prompt'

/**
 * Fix with AI from the keyboard popup. The range is the tracked one, converted against the
 * text as it is now, so edits since the report move it with the code it points at.
 */
export function peekFixRequest(
  model: DiagnosticPeekModel,
  text: TextReadSnapshot,
): DiagnosticFixRequest | null {
  const { end, start } = model.geometry.range
  const range = { start: position(text, start), end: position(text, end) }
  const path = diagnosticTargetForUri(model.documentUri, range)?.path
  if (!path) return null

  return {
    code: model.code,
    message: model.message,
    path,
    range,
    severity: model.severityLevel,
    source: model.source,
    surface: 'peek',
  }
}

function position(text: TextReadSnapshot, offset: number) {
  const line = text.lineAt(offset)
  return { line, character: offset - text.lineStart(line) }
}
