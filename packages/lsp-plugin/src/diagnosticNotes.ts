import type {
  TooltipAction,
  TooltipNote,
  TooltipNoteLink,
} from '@singapore-editor/plugin-ui/tooltip'
import type * as lsp from 'vscode-languageserver-protocol'

import { documentUriToFileName } from './paths'
import type { LanguageServerDefinitionTarget } from './types'

export type OpenLocation = (target: LanguageServerDefinitionTarget) => void

/** The lines a hover shows under its text for the diagnostics at that offset. */
export function diagnosticNotes(
  diagnostics: readonly lsp.Diagnostic[],
  openLocation: OpenLocation,
  actionsForDiagnostic?: (diagnostic: lsp.Diagnostic) => readonly TooltipAction[],
): readonly TooltipNote[] {
  return diagnostics.map((diagnostic) =>
    diagnosticNote(diagnostic, openLocation, actionsForDiagnostic?.(diagnostic)),
  )
}

function diagnosticNote(
  diagnostic: lsp.Diagnostic,
  openLocation: OpenLocation,
  actions?: readonly TooltipAction[],
): TooltipNote {
  return {
    actions,
    text: typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value,
    source: diagnostic.source,
    code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
    codeHref: diagnostic.codeDescription?.href,
    related: (diagnostic.relatedInformation ?? []).flatMap((related) =>
      relatedLink(related, openLocation),
    ),
  }
}

function relatedLink(
  related: lsp.DiagnosticRelatedInformation,
  openLocation: OpenLocation,
): readonly TooltipNoteLink[] {
  const fileName = documentUriToFileName(related.location.uri)
  if (!fileName) return []

  const { start } = related.location.range
  return [
    {
      label: `${basename(fileName)}(${start.line + 1}, ${start.character + 1}): `,
      text: related.message,
      open: () =>
        openLocation({
          uri: related.location.uri,
          path: fileName.replace(/^\/+/, ''),
          range: related.location.range,
        }),
    },
  ]
}

function basename(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf('/') + 1)
}
