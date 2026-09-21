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
}

const unknownRelease: ReleaseInfo = { release: null, commit: null, dirtyFiles: null }

// `build-config.json` sits one level above the release's `web/` and `server/`.
export function releaseFileFor(directory: string) {
  return path.join(directory, '..', 'build-config.json')
}

export async function readReleaseInfo(file: string | undefined): Promise<ReleaseInfo> {
  if (!file) return unknownRelease

  const handle = Bun.file(file)
  if (!(await handle.exists())) return unknownRelease

  return toReleaseInfo((await handle.json()) as BuildConfig)
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
