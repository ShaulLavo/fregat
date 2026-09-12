import type { EntryTypeFilter } from './tree-entry'

type WorkspaceSearchSource = 'disk' | 'open-buffer'
export type WorkspaceSearchMatchMode = 'literal' | 'regex' | 'fuzzy'
export type WorkspaceSearchProviderSource = 'fallback' | 'fd' | 'index' | 'rg'
type WorkspaceSearchIndexReadiness = 'cold' | 'building' | 'ready' | 'stale' | 'failed'
export type WorkspaceSearchWarningCode =
  | 'content-tool-partial-failure'
  | 'file-limit-reached'
  | 'multiline-query-unsupported'
export type WorkspaceSearchIndexFallbackReason =
  | 'building'
  | 'cold'
  | 'disabled'
  | 'failed'
  | 'regex-name-query'
  | 'root-mismatch'
  | 'stale'

export type WorkspaceSearchQuery = {
  caseSensitive?: boolean
  entryType?: EntryTypeFilter
  excludeGlobs?: readonly string[]
  fileLimit?: number
  includeContent: boolean
  includeGlobs?: readonly string[]
  includeNames?: boolean
  limit: number
  matchMode?: WorkspaceSearchMatchMode
  maxDepth?: number
  path: string
  query: string
  streamNameMatchesEarly?: boolean
  useWorkspaceIndex?: boolean
  wholeWord?: boolean
}

export type WorkspaceSearchMatch = {
  birthtimeMs?: number
  column?: number
  endColumn?: number
  kind: 'name' | 'content'
  line?: number
  mtimeMs?: number
  path: string
  preview?: string
  previewStartColumn?: number
  size?: number
  source: WorkspaceSearchSource
  targetType?: EntryTypeFilter
  type: EntryTypeFilter
}

export type WorkspaceSearchProviderMeasurement = {
  durationMs: number
  firstResultMs?: number
  resultCount: number
  source: WorkspaceSearchProviderSource
  statCallCount: number
  statDurationMs: number
}

export type WorkspaceSearchStatPathCount = {
  count: number
  durationMs: number
  path: string
}

export type WorkspaceSearchIndexMeasurement = {
  fallbackReason?: WorkspaceSearchIndexFallbackReason
  pendingCreatedPathCount: number
  readiness?: WorkspaceSearchIndexReadiness
  staleEntryCount: number
  used: boolean
}

export type WorkspaceSearchMeasurement = {
  durationMs: number
  firstResultMs?: number
  providerSources: WorkspaceSearchProviderSource[]
  providers: WorkspaceSearchProviderMeasurement[]
  repeatedStatPathCount: number
  statCallCount: number
  statDurationMs: number
  statPathCount: number
  topStatPaths: WorkspaceSearchStatPathCount[]
  workspaceIndex?: WorkspaceSearchIndexMeasurement
}

export type WorkspaceSearchWarningEvent = {
  code: WorkspaceSearchWarningCode
  detail?: string
  message: string
  type: 'warning'
}

export type WorkspaceSearchDoneEvent = {
  count: number
  fileCount?: number
  measurement?: WorkspaceSearchMeasurement
  path: string
  query: string
  truncated: boolean
  type: 'done'
}

export type WorkspaceSearchEvent =
  | {
      match: WorkspaceSearchMatch
      type: 'match'
    }
  | WorkspaceSearchDoneEvent
  | WorkspaceSearchWarningEvent
  | {
      code: string
      message: string
      type: 'error'
    }
