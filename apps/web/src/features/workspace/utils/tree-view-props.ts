import type { FileTreeController } from '@workspace/tree'
import type {
  FileTreeCompositionOptions,
  FileTreeRenderOptions,
  FileTreeRowDecorationRenderer,
  FileTreeSearchBlurBehavior,
} from '@workspace/tree'
import type { GitStatus } from '@workspace/tree'
import type { TreeRowElements } from '@/features/workspace/state/tree-row-elements'

export interface TreeViewProps extends Omit<FileTreeRenderOptions, 'initialVisibleRowCount'> {
  composition?: FileTreeCompositionOptions
  controller: FileTreeController
  directoriesWithGitChanges?: ReadonlySet<string>
  gitStatusByPath?: ReadonlyMap<string, GitStatus>
  ignoredGitDirectories?: ReadonlySet<string>
  // First-render viewport height in CSS pixels, used as the fallback when the
  // scroll element's clientHeight is still zero. The public option is
  // `initialVisibleRowCount` (rows); the resolver multiplies it by itemHeight
  // before passing the pixel value down here.
  initialViewportHeight?: number
  instanceId?: string
  loadingPaths?: ReadonlySet<string>
  renamingEnabled?: boolean
  renderRowDecoration?: FileTreeRowDecorationRenderer
  rowElements?: TreeRowElements
  searchBlurBehavior?: FileTreeSearchBlurBehavior
  searchEnabled?: boolean
  searchFakeFocus?: boolean
  searchPlaceholder?: string
}
