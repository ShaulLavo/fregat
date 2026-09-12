import { CopyIcon } from '@phosphor-icons/react'

import { actionItem, section } from '@/features/menus/utils/model'

export function copyPathSection({
  copyPath,
  path,
  relativePath,
}: {
  readonly copyPath: (path: string, label: string) => void
  readonly path: string | null
  readonly relativePath: string
}) {
  return section('copy', [
    actionItem({
      disabled: path === null,
      icon: CopyIcon,
      id: 'copyPath',
      label: 'Copy Path',
      run: () => copyPath(path ?? '', 'path'),
    }),
    actionItem({
      icon: CopyIcon,
      id: 'copyRelativePath',
      label: 'Copy Relative Path',
      run: () => copyPath(relativePath, 'relative path'),
    }),
  ])
}
