import { Desk } from '@/features/workspace/components/desk'
import type { ShellProps } from '@/lib/shell/utils/props'

/** The desktop shell. With no folder open the window titlebar is its only chrome. */
export function WorkbenchShell({ children, rootPath }: ShellProps) {
  if (rootPath === null) return children
  return <Desk rootPath={rootPath} />
}
