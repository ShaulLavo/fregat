import type { LanguageServerDiagnosticActions } from './types'
import type { TooltipAction } from '@singapore-editor/plugin-ui/tooltip'
import {
  lspPositionToOffsetInSnapshot,
  offsetToLspPositionInSnapshot,
  type LspRequestOptions,
} from '@singapore-editor/lsp'
import type {
  EditorHoverParticipant,
  HoverPart,
  HoverRequest,
} from '@singapore-editor/plugin-ui/hover-participant'
import type * as lsp from 'vscode-languageserver-protocol'

import { diagnosticNotes, type OpenLocation } from './diagnosticNotes'
import {
  diagnosticsAtOffset,
  indexDiagnosticOffsets,
  type DiagnosticOffsetIndex,
} from './diagnosticProjection'
import type { ActiveDocument } from './pluginTypes'
import type { LanguageServerFeatureRouter, LanguageServerHoverUpdate } from './serverSet'

/** Diagnostics above the server's prose, the way VS Code orders its marker and Markdown hovers. */
const DIAGNOSTIC_ORDINAL = 1
const HOVER_TEXT_ORDINAL = 3

export type LanguageServerHoverParticipantOptions = {
  readonly router: LanguageServerFeatureRouter
  requestHover(
    params: lsp.TextDocumentPositionParams,
    options: LspRequestOptions,
    onUpdate: (update: LanguageServerHoverUpdate) => void,
  ): Promise<lsp.Hover | null>
  getActiveDocument(): ActiveDocument | null
  getDiagnostics(): readonly lsp.Diagnostic[]
  readonly getDiagnosticActions?: LanguageServerDiagnosticActions
  /** Follows a diagnostic's related-information link. */
  openLocation?: OpenLocation
  onRequestSuccess?(): void
  onRequestError(error: unknown): void
}

/**
 * What the language server has to say at a position: its hover answer, progressively as each lane
 * replies, and the diagnostics published for that offset.
 */
export function createLanguageServerHoverParticipant(
  options: LanguageServerHoverParticipantOptions,
): EditorHoverParticipant {
  let diagnosticIndex: { index: DiagnosticOffsetIndex; textVersion: number } | null = null
  // Outlives the tooltip, so reopening a hover joins a run instead of starting a second one.
  const runningActions = new Map<string, Promise<void>>()

  // Keyed on the published array and the text it was projected onto, so a pointer move pays for
  // the index only when either changes.
  const diagnosticIndexFor = (active: ActiveDocument): DiagnosticOffsetIndex => {
    const diagnostics = options.getDiagnostics()
    const cached = diagnosticIndex
    if (
      cached &&
      cached.index.diagnostics === diagnostics &&
      cached.textVersion === active.textVersion
    ) {
      return cached.index
    }

    const index = indexDiagnosticOffsets(active, diagnostics)
    diagnosticIndex = { index, textVersion: active.textVersion }
    return index
  }

  return {
    computeSync: (request) => {
      const active = options.getActiveDocument()
      if (!active) return []

      const diagnostics = diagnosticsAtOffset(diagnosticIndexFor(active), request.anchor.offset)
      if (diagnostics.length === 0) return []

      return [
        {
          ordinal: DIAGNOSTIC_ORDINAL,
          range: request.anchor.range,
          notes: diagnosticNotes(
            diagnostics,
            options.openLocation ?? (() => undefined),
            (diagnostic) => diagnosticActions(options, runningActions, active, diagnostic),
          ),
        },
      ]
    },
    computeAsync: async (request, emit) => {
      const active = options.getActiveDocument()
      if (!active || !options.router.hasReady('hover', 'textDocument/hover')) return

      const publish = (hovers: readonly lsp.Hover[]): void =>
        emit(hovers.flatMap((hover) => hoverParts(active, request, hover)))
      try {
        const hover = await options.requestHover(
          {
            textDocument: { uri: active.uri },
            position: offsetToLspPositionInSnapshot(active, request.anchor.offset),
          },
          { signal: request.signal },
          (update) => publish(update.hovers),
        )
        if (request.signal.aborted) return
        options.onRequestSuccess?.()
        if (hover) publish([hover])
      } catch (error) {
        if (!isAbortError(error)) options.onRequestError(error)
      }
    },
  }
}

function diagnosticActions(
  options: LanguageServerHoverParticipantOptions,
  runningActions: Map<string, Promise<void>>,
  active: ActiveDocument,
  diagnostic: lsp.Diagnostic,
): readonly TooltipAction[] {
  try {
    const actions =
      options.getDiagnosticActions?.({
        documentUri: active.uri,
        textVersion: active.textVersion,
        diagnostic,
      }) ?? []
    return actions.map((action) => ({
      ...action,
      run: () => runDiagnosticAction(options, runningActions, active, diagnostic, action),
    }))
  } catch (error) {
    options.onRequestError(error)
    return []
  }
}

function runDiagnosticAction(
  options: LanguageServerHoverParticipantOptions,
  runningActions: Map<string, Promise<void>>,
  active: ActiveDocument,
  diagnostic: lsp.Diagnostic,
  action: TooltipAction,
): void | Promise<void> {
  const key = diagnosticKey(diagnostic)
  const current = options.getActiveDocument()
  if (
    !current ||
    current.uri !== active.uri ||
    current.textVersion !== active.textVersion ||
    !options.getDiagnostics().some((candidate) => diagnosticKey(candidate) === key)
  )
    throw new Error('The diagnostic changed. Reopen its hover.')

  const runKey = JSON.stringify([active.uri, active.textVersion, key, action.label])
  const running = runningActions.get(runKey)
  if (running) return running

  const result = reportActionFailure(options, action)
  if (!result) return
  const run = result.finally(() => runningActions.delete(runKey))
  runningActions.set(runKey, run)
  return run
}

// The tooltip may be gone by the time a slow action fails, so the host always hears about it.
function reportActionFailure(
  options: LanguageServerHoverParticipantOptions,
  action: TooltipAction,
): void | Promise<void> {
  const report = (error: unknown): never => {
    options.onRequestError(error)
    throw error
  }
  let result: void | Promise<void>
  try {
    result = action.run()
  } catch (error) {
    return report(error)
  }
  return result ? result.catch(report) : undefined
}

// A republish replaces the diagnostic objects, so staleness compares what the user was shown.
function diagnosticKey(diagnostic: lsp.Diagnostic): string {
  const { range, severity, code, source, message } = diagnostic
  return JSON.stringify([
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
    severity,
    code,
    source,
    typeof message === 'string' ? message : message.value,
  ])
}

function hoverParts(
  active: ActiveDocument,
  request: HoverRequest,
  hover: lsp.Hover,
): readonly HoverPart[] {
  const markdown = hoverContentsText(hover.contents).trim()
  if (!markdown) return []

  return [
    {
      ordinal: HOVER_TEXT_ORDINAL,
      range: hoverRangeOffsets(active, hover) ?? request.anchor.range,
      markdown,
    },
  ]
}

function hoverContentsText(contents: lsp.Hover['contents']): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(markedStringText).join('\n\n')
  if ('kind' in contents) return contents.value
  return markedStringText(contents)
}

function markedStringText(value: lsp.MarkedString): string {
  if (typeof value === 'string') return value
  return ['```' + value.language, value.value, '```'].join('\n')
}

function hoverRangeOffsets(
  active: ActiveDocument,
  hover: lsp.Hover,
): { readonly start: number; readonly end: number } | null {
  if (!hover.range) return null

  const start = lspPositionToOffsetInSnapshot(active, hover.range.start)
  const end = lspPositionToOffsetInSnapshot(active, hover.range.end)
  if (end > start) return { start, end }
  return null
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (typeof error !== 'object' || error === null) return false
  return 'name' in error && error.name === 'LspRequestCancelledError'
}
