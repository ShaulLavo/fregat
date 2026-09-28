import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'

export type FileVersionSource = Pick<Stats, 'mtimeMs' | 'size'>

export function fileVersion(source: FileVersionSource): string {
  return `stat:${Number(source.mtimeMs)}:${Number(source.size)}`
}

export function textFileVersion(content: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}
