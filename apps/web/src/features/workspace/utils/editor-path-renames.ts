export function editorPathRenames(paths: readonly string[], from: string, to: string) {
  if (from === to) return []

  return [...new Set(paths)]
    .filter((path) => path === from || path.startsWith(`${from}/`))
    .map((path) => ({ from: path, to: `${to}${path.slice(from.length)}` }))
}
