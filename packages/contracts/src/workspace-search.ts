import * as v from 'valibot'
import type { EntryTypeFilter } from './tree-entry'

// VS Code's default result cap. Truncation is where a parallel ripgrep run stops being
// deterministic, so the cap is high enough to be rare. The route rejects rather than clamps.
export const WORKSPACE_SEARCH_LIMIT_MAX = 20000

export type WorkspaceSearchMatchMode = 'literal' | 'regex' | 'fuzzy'
export type WorkspaceSearchProviderSource = 'fallback' | 'fd' | 'index' | 'rg'
type WorkspaceSearchIndexReadiness = 'cold' | 'building' | 'ready' | 'stale' | 'failed' | 'off'
export type WorkspaceSearchWarningCode =
  | 'content-tool-partial-failure'
  | 'file-limit-reached'
  | 'multiline-query-unsupported'
export type WorkspaceSearchIndexFallbackReason =
  | 'building'
  | 'cold'
  | 'disabled'
  | 'failed'
  | 'off'
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

export const entryTypeSchema = v.union([
  v.literal('file'),
  v.literal('directory'),
  v.literal('symlink'),
  v.literal('other'),
])

export const workspaceSearchMatchSchema = v.object({
  birthtimeMs: v.optional(v.number()),
  column: v.optional(v.number()),
  endColumn: v.optional(v.number()),
  kind: v.union([v.literal('name'), v.literal('content')]),
  line: v.optional(v.number()),
  mtimeMs: v.optional(v.number()),
  path: v.string(),
  preview: v.optional(v.string()),
  previewStartColumn: v.optional(v.number()),
  size: v.optional(v.number()),
  source: v.union([v.literal('disk'), v.literal('open-buffer')]),
  targetType: v.optional(entryTypeSchema),
  type: entryTypeSchema,
})

export type WorkspaceSearchMatch = v.InferOutput<typeof workspaceSearchMatchSchema>

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
