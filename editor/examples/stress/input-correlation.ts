import { fail } from './errors.ts'

export interface Operation {
  id: number
  input: string
  startedAtMs: number
}
export interface CorrelationView {
  id: string
  documentId: string
  documentVersion: number
  revision: number
}
export interface CorrelationEvent {
  id: number
  dispatchAt: number
  completedAt: number
  revisionBefore: number
  revisionAfter: number
}
export interface CorrelationDiagnostic {
  name: string
  timestampMs: number
  durationMs?: number
  operation?: Operation
  view?: unknown
  detail?: unknown
}
export interface CorrelationInput {
  events: readonly unknown[]
  diagnostics: readonly unknown[]
  scenario: string
  views: string
  documentId: string
}
type OperatedDiagnostic = CorrelationDiagnostic & { operation: Operation }
type CorrelationContext = {
  inputs: OperatedDiagnostic[]
  grouped: Map<number, OperatedDiagnostic[]>
  used: Set<number>
  scenario: string
  views: string
  documentId: string
}

function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`Missing correlation ${label}`)
}

export function validateDiagnostic(value: unknown): asserts value is CorrelationDiagnostic {
  record(value, 'diagnostic')
  text(value.name, 'diagnostic name')
  finite(value.timestampMs, 'diagnostic timestamp')
  if (value.durationMs !== undefined) finite(value.durationMs, 'handler duration')
  if (value.operation !== undefined) validateOperation(value.operation)
}
function validateOperation(value: unknown): asserts value is Operation {
  record(value, 'operation')
  integer(value.id, 'operation id', 1)
  text(value.input, 'operation scope')
  finite(value.startedAtMs, 'operation start')
}
function validateEvent(value: unknown): asserts value is CorrelationEvent {
  record(value, 'event')
  integer(value.id, 'event id', 1)
  finite(value.dispatchAt, 'event dispatch')
  finite(value.completedAt, 'event completion')
  integer(value.revisionBefore, 'revision before')
  integer(value.revisionAfter, 'revision after')
}
const epsilon = 0.000001
const scopes: Record<string, string> = {
  typing: 'input.beforeinput',
  repeat: 'input.beforeinput',
  'composition-update': 'input.compositionupdate',
  'composition-commit': 'input.compositionend',
  paste: 'input.paste',
  undo: 'undo',
}
const deferredName =
  /^editor\.(?:secondary\.|syntax\.(?:range|structural|highlight|warm)\.(?:request|apply|accepted|fail)$)/

function finite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    fail(`Invalid correlation ${label}`)
}

function integer(value: unknown, label: string, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    fail(`Invalid correlation ${label}`)
}

function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.length) fail(`Missing correlation ${label}`)
}

function sameOperation(left: Operation | undefined, right: Operation) {
  return (
    left?.id === right.id && left.input === right.input && left.startedAtMs === right.startedAtMs
  )
}

function indexDiagnostics(diagnostics: readonly CorrelationDiagnostic[]) {
  const grouped = new Map<number, OperatedDiagnostic[]>()
  for (const diagnostic of diagnostics) {
    text(diagnostic?.name, 'diagnostic name')
    finite(diagnostic.timestampMs, 'diagnostic timestamp')
    if (!diagnostic.operation) continue
    const operation = diagnostic.operation
    integer(operation.id, 'operation id', 1)
    text(operation.input, 'operation scope')
    finite(operation.startedAtMs, 'operation start')
    if (diagnostic.timestampMs + epsilon < operation.startedAtMs)
      fail('Diagnostic predates its operation')
    const records = grouped.get(operation.id) ?? []
    if (records.length && !sameOperation(records[0].operation, operation))
      fail('Conflicting operation identity')
    records.push({ ...diagnostic, operation })
    grouped.set(operation.id, records)
  }
  return grouped
}

export function correlateInputEvents({
  events,
  diagnostics,
  scenario,
  views,
  documentId,
}: CorrelationInput) {
  if (!Array.isArray(events) || !events.length || !Array.isArray(diagnostics))
    fail('Missing input correlation observations')
  if (!Object.hasOwn(scopes, scenario) || !['single', 'multiple'].includes(views))
    fail('Unknown input correlation workload')
  text(documentId, 'document id')
  const validated = diagnostics.map((diagnostic) => {
    validateDiagnostic(diagnostic)
    return diagnostic
  })
  const grouped = indexDiagnostics(validated)
  const inputs = validated.filter(
    (diagnostic): diagnostic is OperatedDiagnostic =>
      diagnostic.operation !== undefined &&
      diagnostic.name === 'editor.input' &&
      diagnostic.operation?.input === scopes[scenario],
  )
  const used = new Set<number>()
  return events.map((event) =>
    correlateEvent(event, { inputs, grouped, used, scenario, views, documentId }),
  )
}

function correlateEvent(event: unknown, context: CorrelationContext) {
  validateEvent(event)
  integer(event?.id, 'event id', 1)
  finite(event.dispatchAt, 'event dispatch')
  finite(event.completedAt, 'event completion')
  integer(event.revisionBefore, 'revision before')
  integer(event.revisionAfter, 'revision after')
  if (event.completedAt + epsilon < event.dispatchAt) fail('Input completion precedes dispatch')
  const matches = context.inputs.filter(
    (input) =>
      input.operation.startedAtMs + epsilon >= event.dispatchAt &&
      input.timestampMs <= event.completedAt + epsilon,
  )
  if (matches.length !== 1) fail(`Missing or ambiguous operation for event ${event.id}`)
  const input = matches[0]
  if (context.used.has(input.operation.id))
    fail('One diagnostic operation matched multiple input events')
  context.used.add(input.operation.id)
  finite(input.durationMs, 'handler duration')
  if (input.durationMs > input.timestampMs - input.operation.startedAtMs + epsilon)
    fail('Handler duration exceeds its operation interval')
  const records = context.grouped.get(input.operation.id)
  if (!records) fail('Missing correlated operation diagnostics')
  const views = correlateViews(records, event, context, input.timestampMs)
  return {
    eventId: event.id,
    operation: input.operation,
    documentId: context.documentId,
    revision: event.revisionAfter,
    completedAtMs: input.timestampMs,
    durationMs: input.durationMs,
    views,
    deferred: correlateDeferred(records, views, event, context.documentId),
  }
}

function correlateViews(
  records: readonly CorrelationDiagnostic[],
  event: CorrelationEvent,
  context: CorrelationContext,
  inputCompletedAt: number,
) {
  const commits = records.filter(
    (record: { name: string }) => record.name === 'editor.document.committed',
  )
  const updates = records.filter(
    (record: { name: string }) => record.name === 'editor.view.updated',
  )
  if (context.scenario === 'composition-update') {
    if (commits.length || event.revisionBefore !== event.revisionAfter)
      fail('Composition preedit committed a document revision')
    return []
  }
  if (event.revisionAfter <= event.revisionBefore)
    fail('Correlated edit did not advance its revision')
  const expected = context.views === 'multiple' ? 3 : 1
  if (commits.length !== expected || updates.length !== expected)
    fail('Missing or duplicate affected view diagnostics')
  const seen = new Set<string>()
  const views = commits.map((commit) =>
    correlateView(commit, updates, seen, event, context.documentId, inputCompletedAt),
  )
  if (new Set(views.map((view) => view.documentVersion)).size !== 1)
    fail('Affected views disagree on document version')
  return views
}

function validateView(
  view: unknown,
  event: CorrelationEvent,
  documentId: string,
): asserts view is CorrelationView {
  record(view, 'view')
  text(view?.id, 'view id')
  integer(view.revision, 'view revision')
  integer(view.documentVersion, 'document version')
  if (view.documentId !== documentId || view.revision !== event.revisionAfter)
    fail('Incorrect document or stale revision in correlated view')
}

function correlateView(
  commit: CorrelationDiagnostic,
  updates: readonly CorrelationDiagnostic[],
  seen: Set<string>,
  event: CorrelationEvent,
  documentId: string,
  inputCompletedAt: number,
) {
  validateView(commit.view, event, documentId)
  if (seen.has(commit.view.id)) fail('Duplicate affected view identity')
  seen.add(commit.view.id)
  const commitView = commit.view
  const matching = updates.filter(
    (update) =>
      update.view !== null &&
      typeof update.view === 'object' &&
      'id' in update.view &&
      update.view.id === commitView.id,
  )
  if (matching.length !== 1) fail('Missing or ambiguous affected view update')
  const update = matching[0]
  validateView(update.view, event, documentId)
  if (update.view.documentVersion !== commit.view.documentVersion)
    fail('Commit and update disagree on document version')
  if (
    commit.timestampMs > update.timestampMs + epsilon ||
    update.timestampMs > inputCompletedAt + epsilon
  )
    fail('Affected view update falls outside the synchronous input interval')
  return { ...commit.view, committedAtMs: commit.timestampMs, updatedAtMs: update.timestampMs }
}

function correlateDeferred(
  records: readonly CorrelationDiagnostic[],
  views: readonly (CorrelationView & { committedAtMs: number; updatedAtMs: number })[],
  event: CorrelationEvent,
  documentId: string,
) {
  const deferred = records.filter((record: { name: string }) => deferredName.test(record.name))
  return deferred.map((record) => {
    validateView(record.view, event, documentId)
    const recordView = record.view
    const origin = views.find((view) => view.id === recordView.id)
    if (!origin || origin.documentVersion !== record.view.documentVersion)
      fail('Deferred diagnostic lost its originating view identity')
    return { name: record.name, timestampMs: record.timestampMs, view: record.view }
  })
}

export type InputCorrelation = ReturnType<typeof correlateInputEvents>[number]
