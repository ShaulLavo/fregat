export function arePathSetsEqual(
  currentPaths: ReadonlySet<string>,
  nextPaths: readonly string[],
): boolean {
  if (currentPaths.size !== nextPaths.length) {
    return false
  }

  for (const path of nextPaths) {
    if (!currentPaths.has(path)) {
      return false
    }
  }

  return true
}

// Ancestors in canonical directory form, nearest last. One indexOf walk: the
// split-and-rejoin form is quadratic in segment count.
export function getAncestorDirectoryPaths(path: string): readonly string[] {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
  const ancestors: string[] = []
  let slashIndex = normalizedPath.indexOf('/')
  while (slashIndex !== -1) {
    ancestors.push(normalizedPath.slice(0, slashIndex + 1))
    slashIndex = normalizedPath.indexOf('/', slashIndex + 1)
  }
  return ancestors
}

export function getImmediateParentPath(path: string): string | null {
  const ancestorPaths = getAncestorDirectoryPaths(path)
  return ancestorPaths.at(-1) ?? null
}

export function getSiblingComparisonKey(path: string, parentPath: string | null): string {
  if (parentPath == null) {
    return path
  }

  return path.startsWith(parentPath) ? path.slice(parentPath.length) : path
}

export function isCanonicalDirectoryPath(path: string): boolean {
  return path.endsWith('/')
}

export const toLowerCaseSearchPath = (path: string): string => path.toLowerCase()
