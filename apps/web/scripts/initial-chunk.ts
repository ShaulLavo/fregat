type ChunkingContext = {
  getModuleInfo(id: string): { readonly importedIds: readonly string[] } | null
}

/**
 * A code-splitting group name: `initial` for a module `entry` imports statically, null for any
 * other, which leaves it to the group's other filters and then to automatic splitting.
 */
export function staticGraphChunk(entry: string) {
  let graph: ReadonlySet<string> | null = null
  return (id: string, context: ChunkingContext) => {
    graph ??= staticGraph(entry, context)
    return graph.has(id) ? 'initial' : null
  }
}

function staticGraph(entry: string, context: ChunkingContext) {
  const seen = new Set<string>()
  const pending = [entry]
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (seen.has(id)) continue
    seen.add(id)
    pending.push(...(context.getModuleInfo(id)?.importedIds ?? []))
  }
  return seen
}
