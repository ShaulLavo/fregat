import { CloudIcon, HardDrivesIcon, HouseIcon, type Icon } from '@phosphor-icons/react'

import { basename, displayPath, formatSize } from '@/lib/path-formatters'
import type { fetchPlaces } from '@/features/file-picker/utils/data-helpers'

type PlacesData = Awaited<ReturnType<typeof fetchPlaces>>

export type SidebarLocation = {
  id: string
  label: string
  path: string
  /** App chrome keeps its own glyph; `null` is a folder and wears the file tree's. */
  icon: Icon | null
  /** A short mono fact after the label: checkouts in a project folder, free space on a drive. */
  detail: string | null
  /** The native tooltip: the full path plus what `detail` abbreviates. */
  title: string
  pinned: boolean
}

export type SidebarSection = {
  id: 'pinned' | 'places' | 'projects' | 'drives'
  label: string
  locations: readonly SidebarLocation[]
}

type SectionInput = {
  homePath: string
  data: PlacesData | null
  pinned: readonly string[]
  hidden: readonly string[]
}

/**
 * Pinned, then Places (Home and the home folders), Projects and Drives. A path shows once, in
 * its first section; removed paths drop out of every section except Pinned.
 */
export function sidebarSectionsFor({
  homePath,
  data,
  pinned,
  hidden,
}: SectionInput): readonly SidebarSection[] {
  const pinnedSet = new Set(pinned)
  const shown = new Set<string>()
  const keep = (location: SidebarLocation) => {
    if (shown.has(location.path)) return false
    shown.add(location.path)
    return true
  }
  const automatic = (location: SidebarLocation) => !hidden.includes(location.path) && keep(location)
  const sections: SidebarSection[] = [
    { id: 'pinned', label: 'Pinned', locations: pinned.map(pinnedLocation).filter(keep) },
    {
      id: 'places',
      label: 'Places',
      locations: [homeLocation(homePath), ...placeLocations(data)].filter(automatic),
    },
    { id: 'projects', label: 'Projects', locations: projectLocations(data).filter(automatic) },
    { id: 'drives', label: 'Drives', locations: driveLocations(data).filter(automatic) },
  ]
  return sections
    .map((section) => ({
      ...section,
      locations: section.locations.map((location) => ({
        ...location,
        pinned: pinnedSet.has(location.path),
      })),
    }))
    .filter((section) => section.locations.length > 0)
}

function pinnedLocation(path: string): SidebarLocation {
  return {
    id: `pinned:${path}`,
    label: path ? basename(path) : displayPath(path),
    path,
    icon: null,
    detail: null,
    title: displayPath(path),
    pinned: true,
  }
}

function homeLocation(homePath: string): SidebarLocation {
  return {
    id: 'home',
    label: 'Home',
    path: homePath,
    icon: HouseIcon,
    detail: null,
    title: displayPath(homePath),
    pinned: false,
  }
}

function placeLocations(data: PlacesData | null): SidebarLocation[] {
  return (data?.places ?? []).map((place) => ({
    id: `place:${place.path}`,
    label: place.label,
    path: place.path,
    icon: place.kind === 'cloud' ? CloudIcon : null,
    detail: null,
    title: displayPath(place.path),
    pinned: false,
  }))
}

function projectLocations(data: PlacesData | null): SidebarLocation[] {
  return (data?.projects ?? []).map((folder) => ({
    id: `project:${folder.path}`,
    label: folder.label,
    path: folder.path,
    icon: null,
    detail: folder.repoCount > 0 ? String(folder.repoCount) : null,
    title: `${displayPath(folder.path)} · ${checkoutCount(folder.repoCount)}`,
    pinned: false,
  }))
}

function driveLocations(data: PlacesData | null): SidebarLocation[] {
  return (data?.drives ?? []).map((drive) => ({
    id: `drive:${drive.path}`,
    label: drive.label,
    path: drive.path,
    icon: HardDrivesIcon,
    detail: drive.freeBytes === null ? null : formatSize(drive.freeBytes),
    title: driveTitle(drive),
    pinned: false,
  }))
}

function checkoutCount(count: number) {
  return count === 1 ? '1 git checkout' : `${count} git checkouts`
}

function driveTitle(drive: PlacesData['drives'][number]) {
  const where = displayPath(drive.path)
  if (drive.freeBytes === null || drive.totalBytes === null) return where
  return `${where} · ${formatSize(drive.freeBytes)} free of ${formatSize(drive.totalBytes)}`
}
