import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import type { WorkspacePaths } from './path'

type UserPlaceKind = 'desktop' | 'documents' | 'downloads' | 'bookmark' | 'folder' | 'cloud'

export type UserPlace = { kind: UserPlaceKind; label: string; path: string }

type Candidate = { kind: UserPlaceKind; label: string; absolute: string }

const XDG_PLACES: readonly { kind: UserPlaceKind; xdgKey: string; label: string }[] = [
  { kind: 'desktop', xdgKey: 'XDG_DESKTOP_DIR', label: 'Desktop' },
  { kind: 'documents', xdgKey: 'XDG_DOCUMENTS_DIR', label: 'Documents' },
  { kind: 'downloads', xdgKey: 'XDG_DOWNLOAD_DIR', label: 'Downloads' },
]

/** Where developers keep checkouts by habit; Xcode creates `~/Developer`. */
const DEV_FOLDER_NAMES = [
  'Developer',
  'Projects',
  'projects',
  'Code',
  'code',
  'src',
  'dev',
  'repos',
]

const ICLOUD_DRIVE = path.join('Library', 'Mobile Documents', 'com~apple~CloudDocs')

export type UserPlaceSources = {
  homeDirectory: string
  /** The home's config directory: `user-dirs.dirs` and `gtk-3.0/bookmarks` live there. */
  configDirectory: string
  platform: NodeJS.Platform
}

/**
 * The home's Desktop, Documents and Downloads (XDG paths when `user-dirs.dirs` renames them),
 * then the file manager's bookmarks, the usual dev folders and iCloud Drive; only ones that exist.
 * A folder set to `$HOME` is xdg-user-dirs' way of turning it off.
 */
export async function readUserPlaces(
  paths: WorkspacePaths,
  sources: UserPlaceSources,
): Promise<UserPlace[]> {
  const home = path.resolve(sources.homeDirectory)
  const [userDirs, bookmarks] = await Promise.all([
    readOptionalText(path.join(sources.configDirectory, 'user-dirs.dirs')),
    readOptionalText(path.join(sources.configDirectory, 'gtk-3.0', 'bookmarks')),
  ])
  const configured = parseUserDirs(userDirs, home)
  const candidates: Candidate[] = [
    ...XDG_PLACES.map(({ kind, xdgKey, label }) => ({
      kind,
      label,
      absolute: configured.get(xdgKey) ?? path.join(home, label),
    })),
    ...parseGtkBookmarks(bookmarks).map(({ absolute, label }) => ({
      kind: 'bookmark' as const,
      label,
      absolute,
    })),
    ...DEV_FOLDER_NAMES.map((name) => ({
      kind: 'folder' as const,
      label: name,
      absolute: path.join(home, name),
    })),
  ]
  if (sources.platform === 'darwin')
    candidates.push({
      kind: 'cloud',
      label: 'iCloud Drive',
      absolute: path.join(home, ICLOUD_DRIVE),
    })

  const found = await Promise.all(candidates.map((place) => existingPlace(paths, home, place)))
  return uniqueByRealPath(found)
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

/** GTK's `file:///path Label` lines; other URI schemes are network places this server cannot list. */
function parseGtkBookmarks(text: string) {
  const bookmarks: { absolute: string; label: string }[] = []
  for (const line of text.split('\n')) {
    const match = /^file:\/\/(\S+)(?:\s+(.+))?$/.exec(line.trim())
    if (!match?.[1]) continue
    const absolute = decodeUriPath(match[1])
    if (!absolute || !path.isAbsolute(absolute)) continue
    bookmarks.push({ absolute, label: match[2]?.trim() || path.basename(absolute) || absolute })
  }
  return bookmarks
}

function decodeUriPath(encoded: string) {
  try {
    return path.resolve(decodeURIComponent(encoded))
  } catch {
    return null
  }
}

async function existingPlace(
  paths: WorkspacePaths,
  home: string,
  place: Candidate,
): Promise<(UserPlace & { real: string }) | null> {
  if (place.absolute === home) return null
  const info = await stat(place.absolute).catch(() => null)
  if (!info?.isDirectory()) return null
  try {
    return {
      kind: place.kind,
      label: place.label,
      path: paths.toRelative(place.absolute),
      // Case-insensitive volumes answer both `~/Projects` and `~/projects` with one folder.
      real: await realpath(place.absolute),
    }
  } catch {
    return null
  }
}

function uniqueByRealPath(found: readonly ((UserPlace & { real: string }) | null)[]) {
  const seen = new Set<string>()
  const places: UserPlace[] = []
  for (const place of found) {
    if (!place || seen.has(place.real)) continue
    seen.add(place.real)
    places.push({ kind: place.kind, label: place.label, path: place.path })
  }
  return places
}

export async function readOptionalText(file: string) {
  return readFile(file, 'utf8').catch(() => '')
}
