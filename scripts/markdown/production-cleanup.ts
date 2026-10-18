import { access } from 'node:fs/promises'

export async function listenerAbsent(url: string) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) })
    return false
  } catch {
    return true
  }
}

export async function absent(file: string) {
  try {
    await access(file)
    return false
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return true
    throw error
  }
}
