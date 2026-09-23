/** `/`-separated keys: workspace-relative paths, settings resource keys. */
export function isSameOrInside(path: string, parent: string) {
  return path === parent || path.startsWith(`${parent}/`)
}

/** Either key equals the other or lies inside it: a folder touches every file under it. */
export function slashPathsOverlap(left: string, right: string) {
  return isSameOrInside(left, right) || isSameOrInside(right, left)
}
