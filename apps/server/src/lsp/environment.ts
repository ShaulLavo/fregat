import { access } from 'node:fs/promises'
import path from 'node:path'
export async function firstExistingPath(candidates: readonly string[]) {
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue

    return candidate
  }

  return null
}

export async function exists(candidate: string) {
  try {
    await access(candidate)
    return true
  } catch {
    return false
  }
}

export function virtualEnvironmentPaths(root: string) {
  return [process.env.VIRTUAL_ENV, path.join(root, '.venv'), path.join(root, 'venv')].filter(
    (item): item is string => Boolean(item),
  )
}
