import { filesystemPath } from '@/lib/documents/utils/identity'
import { createClientInvariantError } from '@/lib/structured-errors'

import { statPath } from '@/lib/file-server'
import { isPickedFsEntry, type PickedFsEntry } from '@/lib/file-system-types'

export async function hydratePickedEntry(
  path: string,
  signal: AbortSignal,
): Promise<PickedFsEntry> {
  const statInput = clientPathFromOsPath(path)
  const entry = {
    ...(await statPath(statInput, signal)),
    name: basenameFromOsPath(path),
  }

  if (isPickedFsEntry(entry)) return entry

  throw createClientInvariantError(`Picked path is not a file or directory: ${path}`)
}

function clientPathFromOsPath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  return filesystemPath(normalized.replace(/^\/+/, ''))
}

function basenameFromOsPath(path: string) {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '')
  const name = normalized.split('/').filter(Boolean).at(-1)
  return name ?? 'Root'
}
