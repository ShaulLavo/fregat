import { FolderIcon, FolderOpenIcon, HardDrivesIcon, HouseIcon } from '@phosphor-icons/react'

import { ROOT_PATH, joinPaths } from '@/features/file-picker/utils/model'

export function sidebarLocationsFor(homePath: string) {
  return [
    {
      id: 'root',
      label: 'Root',
      path: ROOT_PATH,
      icon: HardDrivesIcon,
    },
    {
      id: 'home',
      label: 'Home',
      path: homePath,
      icon: HouseIcon,
    },
    {
      id: 'desktop',
      label: 'Desktop',
      path: joinPaths(homePath, 'Desktop'),
      icon: FolderIcon,
      openIcon: FolderOpenIcon,
    },
    {
      id: 'documents',
      label: 'Documents',
      path: joinPaths(homePath, 'Documents'),
      icon: FolderIcon,
      openIcon: FolderOpenIcon,
    },
    {
      id: 'downloads',
      label: 'Downloads',
      path: joinPaths(homePath, 'Downloads'),
      icon: FolderIcon,
      openIcon: FolderOpenIcon,
    },
  ] as const
}

export type SidebarLocation = ReturnType<typeof sidebarLocationsFor>[number]
