import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { WorkspacePaths } from './path'

export type UserPlaceId = 'desktop' | 'documents' | 'downloads'

export type UserPlace = { id: UserPlaceId; path: string }

const PLACES: readonly { id: UserPlaceId; xdgKey: string; fallback: string }[] = [
  { id: 'desktop', xdgKey: 'XDG_DESKTOP_DIR', fallback: 'Desktop' },
  { id: 'documents', xdgKey: 'XDG_DOCUMENTS_DIR', fallback: 'Documents' },
  { id: 'downloads', xdgKey: 'XDG_DOWNLOAD_DIR', fallback: 'Downloads' },
]

/**
 * The home's Desktop, Documents and Downloads that exist, at their XDG paths when
 * `user-dirs.dirs` renames them. A folder set to `$HOME` is xdg-user-dirs' way of turning it off.
 */
export async function readUserPlaces(
  paths: WorkspacePaths,
  homeDirectory: string,
  userDirsFile: string,
): Promise<UserPlace[]> {
  const home = path.resolve(homeDirectory)
  const configured = parseUserDirs(await readOptionalText(userDirsFile), home)
  const candidates = PLACES.map(({ id, xdgKey, fallback }) => ({
    id,
    absolute: configured.get(xdgKey) ?? path.join(home, fallback),
  }))
  const found = await Promise.all(candidates.map((place) => existingPlace(paths, home, place)))
  return found.filter((place) => place !== null)
}

export function parseUserDirs(text: string, home: string) {
  const dirs = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = /^\s*(XDG_[A-Z]+_DIR)\s*=\s*"(.*)"\s*$/.exec(line)
    if (!match?.[1] || match[2] === undefined) continue
    const value = match[2].replace(/^\$HOME(?=\/|$)/, home)
    if (!path.isAbsolute(value)) continue
    dirs.set(match[1], path.resolve(value))
  }
  return dirs
}

async function existingPlace(
  paths: WorkspacePaths,
  home: string,
  place: { id: UserPlaceId; absolute: string },
): Promise<UserPlace | null> {
  if (place.absolute === home) return null
  const info = await stat(place.absolute).catch(() => null)
  if (!info?.isDirectory()) return null
  try {
    return { id: place.id, path: paths.toRelative(place.absolute) }
  } catch {
    return null
  }
}

async function readOptionalText(file: string) {
  return readFile(file, 'utf8').catch(() => '')
}
