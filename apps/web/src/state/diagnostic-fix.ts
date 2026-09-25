import type { QueryClient } from '@tanstack/react-query'

import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { log } from '@/lib/client-logging'
import type { ComposerAttach } from '@/lib/composer-attach/providers/context'
import type { RequestDiagnosticFix } from '@/lib/diagnostic-ai/providers/context'
import {
  diagnosticFixPrompt,
  excerptLineSpan,
  type DiagnosticExcerpt,
  type DiagnosticFixRequest,
} from '@/lib/diagnostic-ai/utils/prompt'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { fetchFile } from '@/lib/file-server'
import { toTreePath } from '@/lib/path-formatters'
import { clientErrors } from '@/lib/structured-errors'

/**
 * Where chat and the editor meet for Fix with AI: read the lines the diagnostic points at,
 * unsaved edits included, and open a new chat draft in the workspace it came from.
 */
export function createDiagnosticFix({
  attach,
  documents,
  queryClient,
  workspace,
}: {
  readonly attach: ComposerAttach
  readonly documents: EditorDocumentStoreApi
  readonly queryClient: QueryClient
  readonly workspace: EditorWorkspaceStoreApi
}): RequestDiagnosticFix {
  return async (request) => {
    const rootPath = workspace.getState().rootFolder?.path
    if (!rootPath) return false

    const excerpt = await readExcerpt(request, documents, queryClient)
    if (!excerpt)
      throw clientErrors.DIAGNOSTIC_CHANGED({
        path: request.path,
        internal: { surface: request.surface, startLine: request.range.start.line },
      })

    const environmentId = activeEnvironmentId()
    const prompt = diagnosticFixPrompt(request, toTreePath(request.path, rootPath), excerpt)
    const opened = await attach.attachTextToNewChat('diagnostic-fix', prompt, {
      environmentId,
      rootPath,
    })
    log.info({
      action: 'chat.diagnostic_fix',
      area: 'chat',
      code: request.code,
      environmentId,
      outcome: opened ? 'opened' : 'unavailable',
      severity: request.severity,
      surface: request.surface,
      unsaved: excerpt.unsaved,
    })
    return opened
  }
}

async function readExcerpt(
  request: DiagnosticFixRequest,
  documents: EditorDocumentStoreApi,
  queryClient: QueryClient,
): Promise<DiagnosticExcerpt | null> {
  const path = filesystemPath(request.path)
  const key = fileDocumentKey(path)
  const state = documents.getState()
  const live = state.getLiveEditorDocument(key)
  if (live) {
    const text = live.buffer.getTextSnapshot()
    const span = excerptLineSpan(request.range, text.lineCount)
    if (!span) return null
    const lines: string[] = []
    for (let line = span.first; line <= span.last; line++) {
      const range = text.lineRange(line)
      lines.push(text.readRange(range.start, range.end).replace(/\r?\n$/, ''))
    }
    return { firstLine: span.first, lines, unsaved: state.dirtyDocumentKeys.has(key) }
  }

  const file = await fetchFile(
    path,
    new AbortController().signal,
    clientForQueryClient(queryClient),
  )
  const all = file.content.split(/\r?\n/)
  const span = excerptLineSpan(request.range, all.length)
  if (!span) return null
  return { firstLine: span.first, lines: all.slice(span.first, span.last + 1), unsaved: false }
}
