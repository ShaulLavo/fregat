import type {
  EntryTypeFilter,
  WorkspaceSearchDoneEvent,
  WorkspaceSearchEvent,
  WorkspaceSearchMatch,
  WorkspaceSearchMeasurement,
  WorkspaceSearchProviderMeasurement,
  WorkspaceSearchProviderSource,
  WorkspaceSearchStatPathCount,
  WorkspaceSearchQuery,
  WorkspaceSearchWarningCode,
  WorkspaceSearchWarningEvent,
} from '@workspace/contracts'

import type { Client } from '../transport/client'
import { parseEdenSseStream, type EdenSseEvent } from '../transport/eden'
import { clientErrors } from './search-errors'

export type WorkspaceSearchResult = {
  count: number
  fileCount?: number
  matches: WorkspaceSearchMatch[]
  measurement?: WorkspaceSearchMeasurement
  path: string
  query: string
  truncated: boolean
  warnings: WorkspaceSearchWarningEvent[]
}

export async function collectWorkspaceSearch(
  query: WorkspaceSearchQuery,
  signal: AbortSignal | undefined,
  client: Client,
): Promise<WorkspaceSearchResult> {
  const matches: WorkspaceSearchMatch[] = []
  const warnings: WorkspaceSearchWarningEvent[] = []
  let done: WorkspaceSearchDoneEvent | null = null

  for await (const event of streamWorkspaceSearch(query, signal, client)) {
    if (event.type === 'match') {
      matches.push(event.match)
      continue
    }

    if (event.type === 'warning') {
      warnings.push(event)
      continue
    }

    if (event.type === 'done') done = event
  }

  // No terminal field is defaulted: a defaulted `truncated: false` reads as a
  // finished run. Belt-and-braces — the producer already throws without `done`.
  if (!done) throw clientErrors.SEARCH_INCOMPLETE({ matchCount: matches.length })

  return {
    count: done.count,
    fileCount: done.fileCount,
    matches,
    measurement: done.measurement,
    path: done.path,
    query: done.query,
    truncated: done.truncated,
    warnings,
  }
}

export async function* streamWorkspaceSearch(
  query: WorkspaceSearchQuery,
  signal: AbortSignal | undefined,
  client: Client,
): AsyncGenerator<WorkspaceSearchEvent> {
  const response = await client.fs.search.events.get({
    query: workspaceSearchRequestQuery(query),
    fetch: { signal },
  })
  if (response.error) throw clientErrors.SEARCH_FAILED({ status: response.status })
  if (!response.data) throw clientErrors.EDEN_STREAM_MISSING({ label: 'Search' })

  let matchCount = 0
  let terminated = false

  for await (const event of parseEdenSseStream(response.data)) {
    signal?.throwIfAborted()

    const parsed = workspaceSearchEventFromSse(event)
    if (parsed.type === 'match') matchCount += 1
    if (parsed.type === 'done') terminated = true
    yield parsed
  }

  // Throwing, not returning: `for await` discards a generator's return value with
  // no diagnostic, so a consumer's catch is the only enforceable handoff.
  if (!terminated) throw clientErrors.SEARCH_INCOMPLETE({ matchCount })
}

function workspaceSearchRequestQuery(query: WorkspaceSearchQuery) {
  return {
    caseSensitive: query.caseSensitive === true,
    entryType: query.entryType,
    excludeGlobs: query.excludeGlobs ? Array.from(query.excludeGlobs) : undefined,
    fileLimit: query.fileLimit,
    includeContent: query.includeContent === true,
    includeGlobs: query.includeGlobs ? Array.from(query.includeGlobs) : undefined,
    includeNames: query.includeNames ?? true,
    limit: query.limit,
    matchMode: query.matchMode ?? 'literal',
    maxDepth: query.maxDepth,
    path: query.path,
    query: query.query,
    streamNameMatchesEarly: query.streamNameMatchesEarly ?? true,
    useWorkspaceIndex: query.useWorkspaceIndex !== false,
    wholeWord: query.wholeWord === true,
  }
}

function workspaceSearchEventFromSse(event: EdenSseEvent): WorkspaceSearchEvent {
  if (event.event === 'match') return matchEvent(event.data)
  if (event.event === 'warning') return warningEventFromData(event.data)
  if (event.event === 'done') return doneEventFromData(event.data)
  if (event.event === 'error') {
    throw clientErrors.SEARCH_EVENT_ERROR({ message: searchEventError(event.data) })
  }

  throw clientErrors.UNEXPECTED_SEARCH_EVENT({ event: event.event })
}

function matchEvent(data: unknown): WorkspaceSearchEvent {
  const match = searchEventMatch(data)
  if (!match) throw clientErrors.SEARCH_MATCH_INVALID()

  return { match, type: 'match' }
}

function searchEventMatch(data: unknown): WorkspaceSearchMatch | null {
  if (!isRecord(data)) return null
  if (!isWorkspaceSearchMatch(data.match)) return null

  return data.match
}

function warningEventFromData(data: unknown): WorkspaceSearchWarningEvent {
  if (!isRecord(data)) return unknownWarningEvent('Search results may be incomplete.')

  const message = propertyString(data, 'message')

  return {
    code: warningCode(data.code),
    detail: optionalString(data.detail),
    message: message || 'Search results may be incomplete.',
    type: 'warning',
  }
}

function unknownWarningEvent(message: string): WorkspaceSearchWarningEvent {
  return { code: 'content-tool-partial-failure', message, type: 'warning' }
}

function warningCode(value: unknown): WorkspaceSearchWarningCode {
  if (value === 'file-limit-reached') return value
  if (value === 'multiline-query-unsupported') return value

  return 'content-tool-partial-failure'
}

// A zeroed `done` is indistinguishable from a legitimate empty result —
// `path: ''` is a valid root — so a malformed payload has to fail here.
function doneEventFromData(data: unknown): WorkspaceSearchDoneEvent {
  if (!isRecord(data)) throw clientErrors.SEARCH_DONE_INVALID()

  return {
    count: propertyNumber(data, 'count'),
    fileCount: optionalNumber(data.fileCount),
    measurement: searchMeasurement(data.measurement),
    path: propertyString(data, 'path'),
    query: propertyString(data, 'query'),
    truncated: propertyBoolean(data, 'truncated'),
    type: 'done',
  }
}

function searchMeasurement(data: unknown): WorkspaceSearchMeasurement | undefined {
  if (!isRecord(data)) return undefined

  return {
    durationMs: propertyNumber(data, 'durationMs'),
    firstResultMs: optionalNumber(data.firstResultMs),
    providerSources: providerSources(data.providerSources),
    providers: providerMeasurements(data.providers),
    repeatedStatPathCount: propertyNumber(data, 'repeatedStatPathCount'),
    statCallCount: propertyNumber(data, 'statCallCount'),
    statDurationMs: propertyNumber(data, 'statDurationMs'),
    statPathCount: propertyNumber(data, 'statPathCount'),
    topStatPaths: statPathCounts(data.topStatPaths),
  }
}

function providerSources(data: unknown): WorkspaceSearchProviderSource[] {
  if (!Array.isArray(data)) return []

  return data.filter(isProviderSource)
}

function providerMeasurements(data: unknown): WorkspaceSearchProviderMeasurement[] {
  if (!Array.isArray(data)) return []

  return data.flatMap(providerMeasurement)
}

function providerMeasurement(data: unknown): WorkspaceSearchProviderMeasurement[] {
  if (!isRecord(data)) return []
  if (!isProviderSource(data.source)) return []

  return [
    {
      durationMs: propertyNumber(data, 'durationMs'),
      firstResultMs: optionalNumber(data.firstResultMs),
      resultCount: propertyNumber(data, 'resultCount'),
      source: data.source,
      statCallCount: propertyNumber(data, 'statCallCount'),
      statDurationMs: propertyNumber(data, 'statDurationMs'),
    },
  ]
}

function statPathCounts(data: unknown): WorkspaceSearchStatPathCount[] {
  if (!Array.isArray(data)) return []

  return data.flatMap(statPathCount)
}

function statPathCount(data: unknown): WorkspaceSearchStatPathCount[] {
  if (!isRecord(data)) return []

  return [
    {
      count: propertyNumber(data, 'count'),
      durationMs: propertyNumber(data, 'durationMs'),
      path: propertyString(data, 'path'),
    },
  ]
}

function isProviderSource(source: unknown): source is WorkspaceSearchProviderSource {
  return source === 'fallback' || source === 'fd' || source === 'index' || source === 'rg'
}

function isWorkspaceSearchMatch(match: unknown): match is WorkspaceSearchMatch {
  if (!isRecord(match)) return false
  if (!isSearchKind(match.kind)) return false
  if (!isSearchSource(match.source)) return false
  if (typeof match.path !== 'string') return false
  if (!isEntryType(match.type)) return false
  if (!isOptionalEntryType(match.targetType)) return false
  if (!isOptionalNumber(match.line)) return false
  if (!isOptionalNumber(match.column)) return false
  if (!isOptionalNumber(match.endColumn)) return false
  if (!isOptionalNumber(match.previewStartColumn)) return false
  if (!isOptionalNumber(match.size)) return false
  if (!isOptionalNumber(match.mtimeMs)) return false
  if (!isOptionalNumber(match.birthtimeMs)) return false

  return isOptionalString(match.preview)
}

function isSearchKind(kind: unknown) {
  return kind === 'name' || kind === 'content'
}

function isSearchSource(source: unknown) {
  return source === 'disk' || source === 'open-buffer'
}

function isOptionalEntryType(type: unknown): type is EntryTypeFilter | undefined {
  if (type === undefined) return true

  return isEntryType(type)
}

function isEntryType(type: unknown): type is EntryTypeFilter {
  return type === 'file' || type === 'directory' || type === 'symlink' || type === 'other'
}

function isOptionalNumber(value: unknown) {
  if (value === undefined) return true

  return typeof value === 'number'
}

function isOptionalString(value: unknown) {
  if (value === undefined) return true

  return typeof value === 'string'
}

function optionalNumber(value: unknown) {
  if (typeof value !== 'number') return undefined

  return value
}

function optionalString(value: unknown) {
  if (typeof value !== 'string') return undefined
  if (!value) return undefined

  return value
}

function searchEventError(data: unknown) {
  if (!isRecord(data)) return 'Search failed.'
  if (isRecord(data.error) && typeof data.error.message === 'string') return data.error.message
  if (typeof data.message === 'string') return data.message

  return 'Search failed.'
}

function propertyNumber(data: Record<string, unknown>, key: string) {
  return typeof data[key] === 'number' ? data[key] : 0
}

function propertyBoolean(data: Record<string, unknown>, key: string) {
  return data[key] === true
}

function propertyString(data: Record<string, unknown>, key: string) {
  return typeof data[key] === 'string' ? data[key] : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
