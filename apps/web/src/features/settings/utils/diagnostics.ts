import { offsetToLspPosition, type lsp } from '@singapore-editor/lsp'
import type {
  SettingsDiagnostic,
  SettingsLayerFile,
  SettingsParseError,
  SettingsTextRange,
  SettingsWriteTarget,
} from '@workspace/contracts'

const ERROR = 1
const WARNING = 2

const DIAGNOSTIC_LABELS: Record<SettingsDiagnostic['kind'], string> = {
  'invalid-value': 'invalid value',
  'scope-not-allowed': 'not allowed in this scope',
  'unknown-key': 'unknown setting',
}

export function settingsEditorDiagnostics(
  target: SettingsWriteTarget,
  file: SettingsLayerFile,
  diagnostics: readonly SettingsDiagnostic[],
): readonly lsp.Diagnostic[] {
  if (file.parseErrors.length > 0) {
    return file.parseErrors.map((error) => parseErrorDiagnostic(file.text, error))
  }

  return diagnostics.flatMap((diagnostic) => {
    if (diagnostic.layer !== target) return []

    const range = file.keyRanges[diagnostic.id]
    if (!range) return []

    return [settingsValueDiagnostic(file.text, range, diagnostic)]
  })
}

function parseErrorDiagnostic(text: string, error: SettingsParseError): lsp.Diagnostic {
  return {
    code: 'parse-error',
    message: error.message,
    range: lspRange(text, error),
    severity: ERROR,
    source: 'settings',
  }
}

function settingsValueDiagnostic(
  text: string,
  range: SettingsTextRange,
  diagnostic: SettingsDiagnostic,
): lsp.Diagnostic {
  const detail = diagnostic.detail ? `: ${diagnostic.detail}` : ''

  return {
    code: diagnostic.kind,
    message: `${diagnostic.id} — ${DIAGNOSTIC_LABELS[diagnostic.kind]}${detail}`,
    range: lspRange(text, range),
    severity: WARNING,
    source: 'settings',
  }
}

function lspRange(text: string, range: SettingsTextRange): lsp.Range {
  const start = clampOffset(text, range.offset)
  const end = clampOffset(text, range.offset + Math.max(0, range.length))

  return {
    start: offsetToLspPosition(text, start),
    end: offsetToLspPosition(text, Math.max(start, end)),
  }
}

function clampOffset(text: string, offset: number): number {
  return Math.min(text.length, Math.max(0, Math.trunc(offset)))
}
