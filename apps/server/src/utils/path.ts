import path from 'node:path'
import { toPosix } from '../fs/path'

export function normalizeNativePath(input: string): string {
  return toPosix(path.resolve(input))
}

export function samePath(left: string, right: string): boolean {
  return normalizeNativePath(left) === normalizeNativePath(right)
}
