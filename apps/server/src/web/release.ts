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

  const config = (await handle.json()) as BuildConfig
  return {
    release: typeof config.release === 'string' ? path.basename(config.release) : null,
    commit: typeof config.commit === 'string' ? config.commit : null,
    dirtyFiles: Array.isArray(config.dirtyFiles) ? config.dirtyFiles.length : null,
  }
}
