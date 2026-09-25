import path from 'node:path'
import * as v from 'valibot'

export const absolutePath = v.pipe(
  v.string(),
  v.startsWith('/'),
  v.check((value) => !value.includes('\0') && !value.includes('\r') && !value.includes('\n')),
)

/** A release installation names the `current` link inside its server root (`~/.platform/server`). */
const RELEASE_CURRENT_LINK = 'current'

export const releaseInstallationSchema = v.object({
  kind: v.literal('release'),
  directory: v.pipe(
    absolutePath,
    v.check((value) => path.posix.basename(value) === RELEASE_CURRENT_LINK),
  ),
  executable: absolutePath,
  /** A development build's own state root; a production release uses the user's ~/.platform. */
  stateHome: v.optional(absolutePath),
})

export const installationSchema = v.variant('kind', [
  v.object({
    kind: v.literal('source'),
    directory: absolutePath,
    executable: absolutePath,
  }),
  releaseInstallationSchema,
])

export type ServerInstallation = v.InferOutput<typeof installationSchema>
export type ReleaseInstallation = v.InferOutput<typeof releaseInstallationSchema>

/** Holds a release's lease records and logs, which must outlive every swap of `current`. */
export function releaseServerRoot(installation: ReleaseInstallation) {
  return path.posix.dirname(installation.directory)
}

/** Every release starts this way, whether from `platform-server` or the SSH launch script. */
const RELEASE_ENV = { NODE_ENV: 'production', BUN_ENV: 'production' } as const

export function releaseEnv(installation: ReleaseInstallation): Readonly<Record<string, string>> {
  if (!installation.stateHome) return RELEASE_ENV
  return { ...RELEASE_ENV, PLATFORM_HOME: installation.stateHome }
}

export function releaseEntry(installation: ReleaseInstallation) {
  return path.posix.join(installation.directory, 'server', 'index.js')
}
