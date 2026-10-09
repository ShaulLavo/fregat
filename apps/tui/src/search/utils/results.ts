import type { WorkspaceSearchMatch, WorkspaceSearchQuery } from '@workspace/contracts'
import { workspaceSearchGlobPatterns } from '@workspace/contracts'
export type SearchOptions = {
  query: string
  include: string
  exclude: string
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}
export function searchQuery(rootPath: string, options: SearchOptions): WorkspaceSearchQuery {
  return {
    path: rootPath,
    query: options.query,
    includeContent: true,
    includeNames: false,
    entryType: 'file',
    limit: 1000,
    matchMode: options.regex ? 'regex' : 'literal',
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    includeGlobs: workspaceSearchGlobPatterns(options.include),
    excludeGlobs: workspaceSearchGlobPatterns(options.exclude),
  }
}
export function resultOptions(matches: readonly WorkspaceSearchMatch[]) {
  return matches
    .map((match) => ({
      name: `${match.path}:${match.line ?? 1}:${match.column ?? 1}`,
      description: match.preview ?? match.path,
      value: match,
    }))
    .sort(
      (left, right) =>
        left.value.path.localeCompare(right.value.path) ||
        (left.value.line ?? 0) - (right.value.line ?? 0),
    )
}
