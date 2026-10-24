import { fail } from './errors.mjs'

const epsilon = 0.000001
const scopes = {
  typing: 'input.beforeinput',
  repeat: 'input.beforeinput',
  'composition-update': 'input.compositionupdate',
  'composition-commit': 'input.compositionend',
  paste: 'input.paste',
  undo: 'undo',
}
const deferredName =
  /^editor\.(?:secondary\.|syntax\.(?:range|structural|highlight|warm)\.(?:request|apply|accepted|fail)$)/

function finite(value, label) {
  if (!Number.isFinite(value) || value < 0) fail(`Invalid correlation ${label}`)
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(`Invalid correlation ${label}`)
}

function text(value, label) {
  if (typeof value !== 'string' || !value.length) fail(`Missing correlation ${label}`)
}

function sameOperation(left, right) {
  return (
    left?.id === right.id && left.input === right.input && left.startedAtMs === right.startedAtMs
  )
}

function indexDiagnostics(diagnostics) {
  const grouped = new Map()
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
    records.push(diagnostic)
    grouped.set(operation.id, records)
  }
  return grouped
}

export function correlateInputEvents({ events, diagnostics, scenario, views, documentId }) {
  if (!Array.isArray(events) || !events.length || !Array.isArray(diagnostics))
    fail('Missing input correlation observations')
  if (!Object.hasOwn(scopes, scenario) || !['single', 'multiple'].includes(views))
    fail('Unknown input correlation workload')
  text(documentId, 'document id')
  const grouped = indexDiagnostics(diagnostics)
  const inputs = diagnostics.filter(
    (diagnostic) =>
      diagnostic.name === 'editor.input' && diagnostic.operation?.input === scopes[scenario],
  )
  const used = new Set()
  return events.map((event) =>
    correlateEvent(event, { inputs, grouped, used, scenario, views, documentId }),
  )
}

function correlateEvent(event, context) {
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

function correlateViews(records, event, context, inputCompletedAt) {
  const commits = records.filter((record) => record.name === 'editor.document.committed')
  const updates = records.filter((record) => record.name === 'editor.view.updated')
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
  const seen = new Set()
  const views = commits.map((commit) =>
    correlateView(commit, updates, seen, event, context.documentId, inputCompletedAt),
  )
  if (new Set(views.map((view) => view.documentVersion)).size !== 1)
    fail('Affected views disagree on document version')
  return views
}

function validateView(view, event, documentId) {
  text(view?.id, 'view id')
  integer(view.documentVersion, 'document version')
  if (view.documentId !== documentId || view.revision !== event.revisionAfter)
    fail('Incorrect document or stale revision in correlated view')
}

function correlateView(commit, updates, seen, event, documentId, inputCompletedAt) {
  validateView(commit.view, event, documentId)
  if (seen.has(commit.view.id)) fail('Duplicate affected view identity')
  seen.add(commit.view.id)
  const matching = updates.filter((update) => update.view?.id === commit.view.id)
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

function correlateDeferred(records, views, event, documentId) {
  const deferred = records.filter((record) => deferredName.test(record.name))
  return deferred.map((record) => {
    validateView(record.view, event, documentId)
    const origin = views.find((view) => view.id === record.view.id)
    if (!origin || origin.documentVersion !== record.view.documentVersion)
      fail('Deferred diagnostic lost its originating view identity')
    return { name: record.name, timestampMs: record.timestampMs, view: record.view }
  })
}
