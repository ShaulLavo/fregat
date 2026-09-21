import { documentUriToFileName, fileNameToDocumentUri } from '@singapore-editor/lsp-plugin/paths'
import type {
  LanguageServerDefinitionTarget,
  LanguageServerDiagnosticSummary,
} from '@singapore-editor/lsp-plugin/websocket'

type Diagnostic = LanguageServerDiagnosticSummary['diagnostics'][number]

export function diagnosticMessageText(message: Diagnostic['message']): string {
  if (typeof message === 'string') return message
  return message.value
}

export function diagnosticSeverityLabel(severity: number | undefined): string {
  if (severity === 1) return 'Error'
  if (severity === 2) return 'Warning'
  if (severity === 3) return 'Information'
  if (severity === 4) return 'Hint'
  return 'Diagnostic'
}

export function diagnosticTarget(
  path: string,
  uri: string,
  diagnostic: Diagnostic,
): LanguageServerDefinitionTarget {
  return { path, range: diagnostic.range, uri }
}

export function diagnosticTargetForUri(
  uri: string,
  range: LanguageServerDefinitionTarget['range'],
): LanguageServerDefinitionTarget | null {
  const path = documentUriToFileName(uri)?.replace(/^\/+/, '')
  if (!path) return null
  return { path, range, uri }
}

export function fileUriForPath(path: string): string {
  return fileNameToDocumentUri(path)
}
