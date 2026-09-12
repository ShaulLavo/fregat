import { filesystemPath } from '@/lib/documents/utils/identity'

export function clientPathFromOsPath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  return filesystemPath(normalized.replace(/^\/+/, ''))
}

export function basenameFromOsPath(path: string) {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '')
  const name = normalized.split('/').filter(Boolean).at(-1)
  return name ?? 'Root'
}
