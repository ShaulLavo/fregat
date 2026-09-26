import { HardDrivesIcon, HouseIcon, type Icon } from '@phosphor-icons/react'

import { ROOT_PATH } from '@/features/file-picker/utils/model'

export type UserPlace = { id: 'desktop' | 'documents' | 'downloads'; path: string }

export type SidebarLocation = {
  id: string
  label: string
  path: string
  /** App chrome keeps its own glyph; `null` is a folder and wears the file tree's. */
  icon: Icon | null
}

const PLACE_LABELS: Record<UserPlace['id'], string> = {
  desktop: 'Desktop',
  documents: 'Documents',
  downloads: 'Downloads',
}

/** Root and Home, then the home folders the server found on disk. */
export function sidebarLocationsFor(
  homePath: string,
  places: readonly UserPlace[],
): readonly SidebarLocation[] {
  return [
    { id: 'root', label: 'Root', path: ROOT_PATH, icon: HardDrivesIcon },
    { id: 'home', label: 'Home', path: homePath, icon: HouseIcon },
    ...places.map((place) => ({
      id: place.id,
      label: PLACE_LABELS[place.id],
      path: place.path,
      icon: null,
    })),
  ]
}
