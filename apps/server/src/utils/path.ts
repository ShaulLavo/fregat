import path from 'node:path'
export function isInsidePath(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (relative === '') return true
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) return false

  return !path.isAbsolute(relative)
}

export function normalizeNativePath(input: string): string {
  return path.resolve(input).split(path.sep).join('/')
}

export function samePath(left: string, right: string): boolean {
  return normalizeNativePath(left) === normalizeNativePath(right)
}
