import { lstat } from 'node:fs/promises'
import path from 'node:path'

export async function gitCwdForPath(absolutePath: string) {
  let candidate = absolutePath
  while (true) {
    const stat = await lstat(candidate).catch(missingPath)
    if (stat?.isDirectory()) return candidate
    const parent = path.dirname(candidate)
    if (parent === candidate) return candidate
    candidate = parent
  }
}

function missingPath(error: unknown) {
  if (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
    return null
  throw error
}

export function lexicalRepositoryRoot(cwd: string, prefix: string) {
  const segments = prefix.split('/').filter(Boolean)
  if (segments.length === 0) return cwd

  return path.resolve(cwd, ...segments.map(() => '..'))
}
