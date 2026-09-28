/** `/`-separated keys: workspace-relative paths, settings resource keys. */
export function isSameOrInside(path: string, parent: string) {
  return path === parent || path.startsWith(`${parent}/`)
}

/** Either key equals the other or lies inside it: a folder touches every file under it. */
export function slashPathsOverlap(left: string, right: string) {
  return isSameOrInside(left, right) || isSameOrInside(right, left)
}

// Canonical directory keys end with `/` (`src/`, `src/lib/`); the tree model and its callers key
// folders that way so a folder and a file of the same name never collide.

/** Every ancestor directory in canonical form, nearest last. One scan: splitting is quadratic. */
export function ancestorDirectoryPaths(path: string): readonly string[] {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
  const ancestors: string[] = []
  let slashIndex = normalizedPath.indexOf('/')
  while (slashIndex !== -1) {
    ancestors.push(normalizedPath.slice(0, slashIndex + 1))
    slashIndex = normalizedPath.indexOf('/', slashIndex + 1)
  }
  return ancestors
}

/** The nearest ancestor directory in canonical form, or null at the top level. */
export function parentDirectoryPath(path: string): string | null {
  return ancestorDirectoryPaths(path).at(-1) ?? null
}

export function isDirectoryPath(path: string): boolean {
  return path.endsWith('/')
}
