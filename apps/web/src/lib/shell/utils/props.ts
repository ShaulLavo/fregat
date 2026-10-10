import type { ReactNode } from 'react'

import type { FilesystemPath } from '@/lib/documents/utils/types'

/** With no folder open, a shell frames `children` (the first-workspace choice) in its own chrome. */
export type ShellProps = {
  readonly rootPath: FilesystemPath | null
  readonly children?: ReactNode
}
