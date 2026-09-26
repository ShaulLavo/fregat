import type { WorkspaceIndex } from './workspace-index'

/**
 * Files per language key: the lowercased extension with its dot (`.ts`), or the lowercased
 * basename for a file without one (`dockerfile`, `.babelrc`). The client owns the key → language
 * map. Ignored files are left out; hidden ones count (`.github/workflows` is most of a repo's YAML).
 */
export function languageCensus(index: WorkspaceIndex): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of index.entryMap().values()) {
    if ((entry.targetType ?? entry.type) !== 'file') continue
    if (entry.gitIgnored || entry.defaultIgnored) continue
    const key = entry.extension || entry.basename.toLowerCase()
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}
