import type { GitFileDiff } from './types'
import { joinPath } from './path-utils'

/** NUL-separated raw records preserve paths containing tabs, newlines and Git quoting characters. */
export function parseRawDiff(output: string, rootPath: string, staged: boolean): GitFileDiff[] {
  const fields = output.split('\0')
  const entries: GitFileDiff[] = []
  for (let index = 0; index < fields.length; index += 1) {
    const header = fields[index]
    if (!header?.startsWith(':')) continue
    const [, , oldId, newId, status] = header.split(' ')
    const before = fields[++index]
    const after = status?.startsWith('R') || status?.startsWith('C') ? fields[++index] : before
    if (!before || !after) continue
    entries.push({
      path: joinPath(rootPath, after),
      oldPath: before === after ? undefined : joinPath(rootPath, before),
      oldObjectId: objectId(oldId),
      newObjectId: objectId(newId),
      oldFileMissing: status === 'A' || undefined,
      newFileMissing: status === 'D' || undefined,
      staged,
      patch: '',
      hunks: [],
    })
  }
  return entries
}

function objectId(value: string | undefined) {
  return value && !/^0+$/.test(value) ? value : undefined
}
