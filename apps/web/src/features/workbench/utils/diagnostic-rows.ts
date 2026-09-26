import type {
  LanguageServerDefinitionTarget,
  LanguageServerDiagnosticSummary,
} from '@singapore-editor/lsp-plugin/websocket'

import { fileUriForPath } from '@workspace/contracts'
import { diagnosticMessageText, diagnosticTarget } from '@/lib/diagnostic'
import type { DiagnosticFixRequest } from '@/lib/diagnostic-ai/utils/prompt'
import type { MarkerResource } from '@/lib/markers/store'

type Diagnostic = LanguageServerDiagnosticSummary['diagnostics'][number]

export type DiagnosticGroupRow = {
  readonly kind: 'group'
  readonly id: string
  readonly label: string
  readonly count: number
  readonly expanded: boolean
  readonly hasChildren: true
  readonly path: string
  readonly uri: string
}

export type DiagnosticItemRow = {
  readonly kind: 'diagnostic'
  readonly id: string
  readonly label: string
  readonly diagnostic: Diagnostic
  readonly parentId: string
  readonly path: string
  readonly target: LanguageServerDefinitionTarget
}

export type DiagnosticRow = DiagnosticGroupRow | DiagnosticItemRow

/**
 * Every file and its diagnostics as one sequence, so the Problems pane is one
 * keyboard list. Row ids carry the resource and the diagnostic's own location,
 * never a file-local index, so a row keeps its id when another file changes.
 */
export function diagnosticRows(
  resources: readonly MarkerResource[],
  collapsedUris: ReadonlySet<string>,
): DiagnosticRow[] {
  return resources.flatMap((resource) => resourceRows(resource, collapsedUris))
}

function resourceRows(resource: MarkerResource, collapsedUris: ReadonlySet<string>) {
  const groupId = `file:${resource.uri}`
  const diagnostics = resource.summary.diagnostics
  const group: DiagnosticGroupRow = {
    kind: 'group',
    id: groupId,
    label: resource.path,
    count: diagnostics.length,
    expanded: !collapsedUris.has(resource.uri),
    hasChildren: true,
    path: resource.path,
    uri: resource.uri,
  }
  if (!group.expanded) return [group]

  const uri = resource.summary.uri ?? fileUriForPath(resource.path)
  const seen = new Map<string, number>()
  const items = diagnostics.map((diagnostic): DiagnosticItemRow => {
    const identity = diagnosticIdentity(resource.uri, diagnostic)
    const occurrence = seen.get(identity) ?? 0
    seen.set(identity, occurrence + 1)
    return {
      kind: 'diagnostic',
      id: `${identity}#${occurrence}`,
      label: diagnosticMessageText(diagnostic.message),
      diagnostic,
      parentId: groupId,
      path: resource.path,
      target: diagnosticTarget(resource.path, uri, diagnostic),
    }
  })
  return [group, ...items]
}

/** Location, severity and text; an exact repeat is told apart by its occurrence. */
function diagnosticIdentity(uri: string, diagnostic: Diagnostic) {
  const { end, start } = diagnostic.range
  const location = `${start.line}:${start.character}-${end.line}:${end.character}`
  return `${uri}@${location}:${diagnostic.severity ?? 0}:${diagnosticMessageText(diagnostic.message)}`
}

export type ActiveDiagnostic = {
  readonly id: string
  /** Where the row was when it was chosen, so a removal lands on a neighbour. */
  readonly index: number
}

/** The active row if it survived a refresh, else whichever row now holds its place. */
export function survivingActiveId(
  rows: readonly DiagnosticRow[],
  active: ActiveDiagnostic | null,
): string | null {
  if (!active) return null
  if (rows.some((row) => row.id === active.id)) return active.id

  return rows[Math.min(active.index, rows.length - 1)]?.id ?? null
}

/** What Fix with AI sends for a Problems row. */
export function diagnosticFixRequest(row: DiagnosticItemRow): DiagnosticFixRequest {
  const { code, range, severity, source } = row.diagnostic
  return {
    code: code === undefined ? null : String(code),
    message: row.label,
    path: row.path,
    range,
    severity,
    source: source ?? null,
    surface: 'problems',
  }
}

/** The row a pending Fix with AI came from, found by what it sent. */
export function fixingRowId(
  rows: readonly DiagnosticRow[],
  request: DiagnosticFixRequest | undefined,
): string | null {
  if (!request) return null
  const row = rows.find(
    (candidate) =>
      candidate.kind === 'diagnostic' &&
      candidate.path === request.path &&
      candidate.label === request.message &&
      sameRange(candidate.diagnostic.range, request.range),
  )
  return row?.id ?? null
}

function sameRange(left: DiagnosticFixRequest['range'], right: DiagnosticFixRequest['range']) {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  )
}
