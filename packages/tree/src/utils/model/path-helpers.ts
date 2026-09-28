// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
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

export function getSiblingComparisonKey(path: string, parentPath: string | null): string {
  if (parentPath == null) {
    return path
  }

  return path.startsWith(parentPath) ? path.slice(parentPath.length) : path
}

export const toLowerCaseSearchPath = (path: string): string => path.toLowerCase()
