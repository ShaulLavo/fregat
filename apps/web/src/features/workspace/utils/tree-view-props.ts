import type { FileTreeController } from '@workspace/tree'
import type {
  FileTreeCompositionOptions,
  FileTreeRenderOptions,
  FileTreeRowDecorationRenderer,
  FileTreeSearchBlurBehavior,
} from '@workspace/tree'
import type { GitStatus } from '@workspace/tree'
import type { TreeRowElements } from '@/features/workspace/state/tree-row-elements'

export interface TreeViewProps extends FileTreeRenderOptions {
  composition?: FileTreeCompositionOptions
  controller: FileTreeController
  directoriesWithGitChanges?: ReadonlySet<string>
  gitStatusByPath?: ReadonlyMap<string, GitStatus>
  ignoredGitDirectories?: ReadonlySet<string>
  instanceId?: string
  loadingPaths?: ReadonlySet<string>
  renamingEnabled?: boolean
  renderRowDecoration?: FileTreeRowDecorationRenderer
  rowElements?: TreeRowElements
  searchBlurBehavior?: FileTreeSearchBlurBehavior
  searchEnabled?: boolean
  searchPlaceholder?: string
}
