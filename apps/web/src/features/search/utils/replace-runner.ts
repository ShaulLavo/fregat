import type { WorkspaceEditApplicationRequest } from '@/features/editor/state/workspace-edit-service'
import { workspaceSearchReplacePlan } from '@/features/search/utils/replace'
import type { FileResult } from '@/lib/file-system-types'
import {
  createDocumentLogicalRevisionScope,
  createEditorTextBuffer,
  offsetToPoint,
  type EditorTextBuffer,
  type PieceTableSnapshot,
  type TextEdit,
  type TextSnapshot,
} from '@singapor/core/document'
import {
  fileNameToDocumentUri,
  type ApplyWorkspaceEditResult,
  type WorkspaceTextDocumentProvenance,
} from '@singapor/lsp-plugin'
import type {
  ParsedWorkspaceTextEdit,
  WorkspaceEditOperation,
} from '@singapor/lsp-plugin/workspace-edit'
import type { WorkspaceSearchMatch, WorkspaceSearchQuery } from '@workspace/contracts'

const SEARCH_ANNOTATION_ID = 'workspace-search-replace'

export type AppliedWorkspaceSearchReplaceResult = {
  readonly changedFiles: number
  readonly replacedMatches: number
  readonly skippedMatches: number
  readonly status: 'applied'
}

export type WorkspaceSearchReplaceResult =
  | AppliedWorkspaceSearchReplaceResult
  | Exclude<ApplyWorkspaceEditResult, { readonly status: 'applied' }>

export type WorkspaceSearchReplaceContext = {
  applyWorkspaceChange: (
    request: WorkspaceEditApplicationRequest,
  ) => Promise<ApplyWorkspaceEditResult>
  fetchFile: (path: string, signal: AbortSignal) => Promise<FileResult>
  getLiveEditorDocument: (path: string) => SearchLiveDocument | null
  rootPath: string
  signal: AbortSignal
}

type SearchLiveDocument = {
  readonly buffer: EditorTextBuffer
  readonly path: string
}

type SearchTargetSource = {
  readonly buffer: EditorTextBuffer
  readonly path: string
  readonly pieceSnapshot: PieceTableSnapshot
  readonly textSnapshot: TextSnapshot
  readonly uri: string
} & (
  | { readonly version: number; readonly fileVersion: null }
  | { readonly version: null; readonly fileVersion: FileResult['version'] }
)

type PreparedSearchRequest = {
  readonly changedFiles: number
  readonly guard: WorkspaceEditApplicationRequest['guard']
  readonly operations: readonly WorkspaceEditOperation[]
  readonly replacedMatches: number
  readonly skippedMatches: number
  readonly sourceFileVersions: ReadonlyMap<string, FileResult['version']>
}

export async function replaceWorkspaceSearchMatches({
  context,
  matches,
  query,
  replaceText,
}: {
  context: WorkspaceSearchReplaceContext
  matches: readonly WorkspaceSearchMatch[]
  query: WorkspaceSearchQuery
  replaceText: string
}): Promise<WorkspaceSearchReplaceResult> {
  const prepared = await prepareSearchRequest(context, matches, query, replaceText)
  if (prepared.operations.length === 0) return emptyAppliedResult(prepared.skippedMatches)

  const result = await context.applyWorkspaceChange({
    guard: prepared.guard,
    label: replaceLabel(prepared.replacedMatches),
    logicalRevisionScope: createDocumentLogicalRevisionScope(),
    originUri: fileNameToDocumentUri(context.rootPath),
    originVersion: 0,
    plan: {
      annotations: new Map([
        [
          SEARCH_ANNOTATION_ID,
          {
            label: 'Workspace search replacement',
            needsConfirmation: true,
          },
        ],
      ]),
      operations: prepared.operations,
    },
    serverId: 'workspace-search',
    signal: context.signal,
    source: 'search-replace',
    sourceFileVersions: prepared.sourceFileVersions,
  })
  if (result.status !== 'applied') return result

  return {
    changedFiles: prepared.changedFiles,
    replacedMatches: prepared.replacedMatches,
    skippedMatches: prepared.skippedMatches,
    status: 'applied',
  }
}

export function workspaceSearchReplaceSummary(result: AppliedWorkspaceSearchReplaceResult) {
  const replaced = `${result.replacedMatches.toLocaleString()} ${matchNoun(
    result.replacedMatches,
  )} replaced`
  const skipped =
    result.skippedMatches > 0 ? `, ${result.skippedMatches.toLocaleString()} skipped` : ''

  return `${replaced}${skipped}.`
}

async function prepareSearchRequest(
  context: WorkspaceSearchReplaceContext,
  matches: readonly WorkspaceSearchMatch[],
  query: WorkspaceSearchQuery,
  replaceText: string,
): Promise<PreparedSearchRequest> {
  const liveSources = new Map<string, SearchTargetSource>()
  const sourceFileVersions = new Map<string, FileResult['version']>()
  const operations: WorkspaceEditOperation[] = []
  let changedFiles = 0
  let replacedMatches = 0
  let skippedMatches = 0

  for (const [path, pathMatches] of contentMatchesByPath(matches)) {
    context.signal.throwIfAborted()
    const source = await searchTargetSource(context, path)
    const plan = workspaceSearchReplacePlan({
      matches: pathMatches,
      query,
      replaceText,
      text: source.textSnapshot,
    })
    skippedMatches += plan.skippedCount
    if (plan.edits.length === 0) continue

    changedFiles += 1
    replacedMatches += plan.appliedCount
    operations.push(textOperation(source, plan.edits))
    if (source.version !== null) liveSources.set(source.uri, source)
    if (source.fileVersion !== null) sourceFileVersions.set(source.uri, source.fileVersion)
  }

  return {
    changedFiles,
    guard: searchOriginGuard(context, liveSources),
    operations,
    replacedMatches,
    skippedMatches,
    sourceFileVersions,
  }
}

async function searchTargetSource(
  context: WorkspaceSearchReplaceContext,
  path: string,
): Promise<SearchTargetSource> {
  const live = context.getLiveEditorDocument(path)
  if (live) return liveTargetSource(live)

  const file = await context.fetchFile(path, context.signal)
  return transientTargetSource(path, file)
}

function liveTargetSource(document: SearchLiveDocument): SearchTargetSource {
  return { ...targetSource(document.path, document.buffer), fileVersion: null, version: 0 }
}

function transientTargetSource(path: string, file: FileResult): SearchTargetSource {
  return {
    ...targetSource(path, createEditorTextBuffer(file.content)),
    fileVersion: file.version,
    version: null,
  }
}

function targetSource(path: string, buffer: EditorTextBuffer) {
  return {
    buffer,
    path,
    pieceSnapshot: buffer.getSnapshot(),
    textSnapshot: buffer.getTextSnapshot(),
    uri: fileNameToDocumentUri(path),
  }
}

function textOperation(
  source: SearchTargetSource,
  edits: readonly TextEdit[],
): WorkspaceEditOperation {
  return {
    annotationId: SEARCH_ANNOTATION_ID,
    edits: edits.map((edit) => workspaceTextEdit(source.pieceSnapshot, edit)),
    kind: 'text-document',
    uri: source.uri,
    version: source.version,
  }
}

function workspaceTextEdit(snapshot: PieceTableSnapshot, edit: TextEdit): ParsedWorkspaceTextEdit {
  return {
    annotationId: SEARCH_ANNOTATION_ID,
    newText: edit.text,
    range: {
      end: workspacePosition(snapshot, edit.to),
      start: workspacePosition(snapshot, edit.from),
    },
  }
}

function workspacePosition(snapshot: PieceTableSnapshot, offset: number) {
  const point = offsetToPoint(snapshot, offset)
  return { character: point.column, line: point.row }
}

function searchOriginGuard(
  context: WorkspaceSearchReplaceContext,
  liveSources: ReadonlyMap<string, SearchTargetSource>,
): WorkspaceEditApplicationRequest['guard'] {
  const documents: WorkspaceTextDocumentProvenance[] = Array.from(
    liveSources.values(),
    (source) => ({
      textSnapshot: source.textSnapshot,
      uri: source.uri,
      version: requiredLiveVersion(source),
    }),
  )

  return {
    documents,
    isCurrent: (uri) => isCurrentLiveSource(context, liveSources.get(uri)),
  }
}

function isCurrentLiveSource(
  context: WorkspaceSearchReplaceContext,
  source: SearchTargetSource | undefined,
): boolean {
  if (!source) return false
  const current = context.getLiveEditorDocument(source.path)
  if (!current || current.buffer !== source.buffer) return false
  if (current.buffer.getSnapshot() !== source.pieceSnapshot) return false
  return current.buffer.getTextSnapshot() === source.textSnapshot
}

function requiredLiveVersion(source: SearchTargetSource): number {
  if (source.version !== null) return source.version
  return 0
}

function emptyAppliedResult(skippedMatches: number): AppliedWorkspaceSearchReplaceResult {
  return {
    changedFiles: 0,
    replacedMatches: 0,
    skippedMatches,
    status: 'applied',
  }
}

function contentMatchesByPath(matches: readonly WorkspaceSearchMatch[]) {
  const groups = new Map<string, WorkspaceSearchMatch[]>()

  for (const match of matches) {
    if (match.kind !== 'content') continue

    const group = groups.get(match.path)
    if (group) {
      group.push(match)
      continue
    }

    groups.set(match.path, [match])
  }

  return groups
}

function replaceLabel(count: number) {
  return `Replace ${count.toLocaleString()} ${matchNoun(count)}`
}

function matchNoun(count: number) {
  return count === 1 ? 'match' : 'matches'
}
