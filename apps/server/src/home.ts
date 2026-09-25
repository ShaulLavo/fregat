import { homedir } from 'node:os'
import path from 'node:path'

const PLATFORM_HOME_DIRECTORY = '.platform'

/**
 * Every path under the app's state home, resolved in one place.
 *
 * `PLATFORM_HOME` moves the whole state root, so dev servers and verification
 * runs never share the production database, settings or secrets. Read per call
 * so a test can set it.
 */
export function platformHomePath(...segments: string[]): string {
  const root = process.env.PLATFORM_HOME || path.join(homedir(), PLATFORM_HOME_DIRECTORY)
  return path.join(root, ...segments)
}

/**
 * Download caches (language servers, fonts) ignore `PLATFORM_HOME`: they are
 * not state, and a per-run server would otherwise re-download them every run.
 */
export function platformCachePath(...segments: string[]): string {
  return path.join(homedir(), PLATFORM_HOME_DIRECTORY, ...segments)
}
