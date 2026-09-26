import { expandRegexReplacement } from '@workspace/client-core/files/search-replace'
import { createWorkspaceSearchMatcher, type WorkspaceSearchQuery } from '@workspace/contracts'

export function replacementText(text: string, query: WorkspaceSearchQuery, replacement: string) {
  const matcher = createWorkspaceSearchMatcher(query)
  let count = 0
  const lines = text.split('\n').map((line) => {
    const matches = matcher.lineMatches(line)
    count += matches.length
    if (query.matchMode === 'regex') return replaceRegexLine(line, query, replacement, matches)
    let output = line
    for (const match of matches.toReversed())
      output = `${output.slice(0, match.start)}${replacement}${output.slice(match.end)}`
    return output
  })
  return { content: lines.join('\n'), count }
}
function replaceRegexLine(
  line: string,
  query: WorkspaceSearchQuery,
  replacement: string,
  matches: readonly { start: number; end: number }[],
) {
  const regex = new RegExp(query.query, query.caseSensitive ? 'gu' : 'giu')
  const allowed = new Set(matches.map((match) => `${match.start}:${match.end}`))
  let output = line
  const results = Array.from(line.matchAll(regex)).toReversed()
  for (const result of results) {
    const start = result.index
    if (!allowed.has(`${start}:${start + result[0].length}`)) continue
    const expanded = expandRegexReplacement(replacement, result)
    output = `${output.slice(0, start)}${expanded}${output.slice(start + result[0].length)}`
  }
  return output
}
