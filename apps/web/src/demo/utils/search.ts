import {
  createWorkspaceSearchMatcher,
  type WorkspaceSearchMatch,
  type WorkspaceSearchMatcher,
} from '@workspace/contracts'
import * as v from 'valibot'
import { searchQuerySchema } from '../../../../server/src/fs/contracts'
import type { DemoFile } from '../state/workspace'

export function searchFiles(url: URL, files: ReadonlyMap<string, DemoFile>) {
  const input = v.parse(searchQuerySchema, Object.fromEntries(url.searchParams))
  const matcher = createWorkspaceSearchMatcher(input)
  const matches: WorkspaceSearchMatch[] = []
  for (const [path, file] of files) {
    if (!path.startsWith(`${input.path.replace(/\/$/u, '')}/`)) continue
    if (!matcher.pathMatches(path.slice(input.path.length + 1))) continue
    appendFileMatches(matches, path, file.content, input, matcher)
    if (matches.length >= input.limit) break
  }
  const limited = matches.slice(0, input.limit)
  return [
    ...limited.map((match) => ({ type: 'match', match })),
    {
      type: 'done',
      path: input.path,
      query: input.query,
      count: limited.length,
      truncated: matches.length > input.limit,
    },
  ]
}

function appendFileMatches(
  matches: WorkspaceSearchMatch[],
  path: string,
  content: string,
  input: v.InferOutput<typeof searchQuerySchema>,
  matcher: WorkspaceSearchMatcher,
) {
  if (input.includeNames && matchesName(path, input, matcher))
    matches.push({ kind: 'name', path, type: 'file', source: 'disk' })
  if (!input.includeContent) return
  for (const [index, line] of content.split('\n').entries())
    appendLineMatches(matches, path, index, line, matcher, input.limit)
}

function appendLineMatches(
  matches: WorkspaceSearchMatch[],
  path: string,
  index: number,
  line: string,
  matcher: WorkspaceSearchMatcher,
  limit: number,
) {
  for (const match of matcher.lineMatches(line, limit - matches.length)) {
    matches.push({
      kind: 'content',
      path,
      type: 'file',
      source: 'disk',
      line: index + 1,
      column: match.start + 1,
      endColumn: match.end + 1,
      preview: line,
      previewStartColumn: 0,
    })
  }
}

function matchesName(
  path: string,
  input: v.InferOutput<typeof searchQuerySchema>,
  matcher: WorkspaceSearchMatcher,
) {
  if (!input.query) return true
  if (input.matchMode !== 'fuzzy') return matcher.lineMatches(path, 1).length > 0
  const query = input.caseSensitive ? input.query : input.query.toLowerCase()
  const name = input.caseSensitive ? path : path.toLowerCase()
  let offset = 0
  for (const char of query) {
    offset = name.indexOf(char, offset)
    if (offset < 0) return false
    offset += 1
  }
  return true
}
