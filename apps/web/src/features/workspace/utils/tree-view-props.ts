import type { FileTreeController } from '@workspace/tree'
import type {
  FileTreeRenderOptions,
  FileTreeRowDecorationRenderer,
  FileTreeSearchBlurBehavior,
} from '@workspace/tree'
import type { GitStatus } from '@workspace/tree'
import type { TreeRowElements } from '@/features/workspace/state/tree-row-elements'
import type { TreeMenuRequest } from '@/features/workspace/utils/tree-row-menu-open'

export interface TreeViewProps extends FileTreeRenderOptions {
  controller: FileTreeController
  directoriesWithGitChanges?: ReadonlySet<string>
  gitStatusByPath?: ReadonlyMap<string, GitStatus>
  ignoredGitDirectories?: ReadonlySet<string>
  instanceId?: string
  loadingPaths?: ReadonlySet<string>
  /** The row whose menu is open; it keeps its hover fill. */
  menuPath?: string | null
  onCloseMenu?: () => void
  /** Present when the host renders row menus. */
  onOpenMenu?: TreeMenuRequest
  renamingEnabled?: boolean
  renderRowDecoration?: FileTreeRowDecorationRenderer
  rowElements?: TreeRowElements
  searchBlurBehavior?: FileTreeSearchBlurBehavior
  searchEnabled?: boolean
  searchPlaceholder?: string
}
