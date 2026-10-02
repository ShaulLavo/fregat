import { readFileSync } from 'node:fs'
import path from 'node:path'

export type ReleaseInfo = {
  release: string | null
  commit: string | null
  dirtyFiles: number | null
}

type BuildConfig = {
  release?: unknown
  commit?: unknown
  dirtyFiles?: unknown
  liveCheck?: unknown
}

const unknownRelease: ReleaseInfo = { release: null, commit: null, dirtyFiles: null }

// `build-config.json` sits one level above the release's `web/` and `server/`.
export function releaseFileFor(directory: string) {
  return path.join(directory, '..', 'build-config.json')
}

export async function readReleaseDescriptor(file: string | undefined): Promise<{
  info: ReleaseInfo
  liveCheckRequired: boolean
}> {
  const unknown = { info: unknownRelease, liveCheckRequired: true }
  if (!file) return unknown

  const handle = Bun.file(file)
  if (!(await handle.exists())) return unknown

  const config = (await handle.json()) as BuildConfig
  return { info: toReleaseInfo(config), liveCheckRequired: config.liveCheck !== false }
}

function toReleaseInfo(config: BuildConfig): ReleaseInfo {
  return {
    release: typeof config.release === 'string' ? path.basename(config.release) : null,
    commit: typeof config.commit === 'string' ? config.commit : null,
    dirtyFiles: Array.isArray(config.dirtyFiles) ? config.dirtyFiles.length : null,
  }
}

/**
 * The same read at boot, before the logger exists. Every log line carries the
 * release and commit so a web build newer than the server is visible in the log
 * rather than only in `GET /release`.
 */
export function readReleaseInfoSync(file: string | undefined): ReleaseInfo {
  if (!file) return unknownRelease

  try {
    return toReleaseInfo(JSON.parse(readFileSync(file, 'utf8')) as BuildConfig)
  } catch {
    return unknownRelease
  }
}

/** The path the release's web build was made for; a checkout run serves from `/`. */
export function readReleaseWebBase(file: string | undefined): string {
  if (!file) return '/'
  try {
    const config: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof config !== 'object' || config === null || !('webBase' in config)) return '/'
    return typeof config.webBase === 'string' ? config.webBase : '/'
  } catch {
    return '/'
  }
}
