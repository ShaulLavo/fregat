import {
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** Production's state home: the owner's real sessions, settings and secrets. */
export const productionStateHome = path.join(homedir(), '.platform')

/** The dev server's state home, kept apart from production (`PLATFORM_HOME`). */
export const devStateHome = '/work/platform-dev/home'

/**
 * Seeds a dev home once, from production: settings, secrets, palettes and theme
 * bundles are copied, the wallpaper library hard-linked. The database starts empty.
 */
export function seedDevStateHome(home: string, source = productionStateHome) {
  if (existsSync(home)) return false
  mkdirSync(home, { recursive: true })
  for (const entry of ['settings.json', 'secrets.json', 'palettes', 'themes']) {
    const from = path.join(source, entry)
    if (existsSync(from)) cpSync(from, path.join(home, entry), { recursive: true })
  }
  if (existsSync(path.join(source, 'wallpapers'))) linkWallpaperLibrary(home, source)
  return true
}

/**
 * Gives a home its own copy of the wallpaper library: a delete there unlinks only its
 * own entry. Hard links make it free on one volume and spare re-seeding the bundled art;
 * a home on another volume (a test under the system temp dir) gets copies.
 */
export function linkWallpaperLibrary(home: string, source = productionStateHome) {
  const from = realpathSync(path.join(source, 'wallpapers'))
  const to = path.join(home, 'wallpapers')
  mkdirSync(to, { recursive: true })
  for (const file of readdirSync(from)) linkOrCopy(path.join(from, file), path.join(to, file))
}

function linkOrCopy(from: string, to: string) {
  try {
    linkSync(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    copyFileSync(from, to, constants.COPYFILE_FICLONE)
  }
}
