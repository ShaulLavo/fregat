import type { SourceFile } from '../githubSource.ts'
import { buildSourceTree, renderTree, type FileSelectHandler } from '../tree.ts'
import { el } from './dom.ts'

export type Sidebar = {
  readonly element: HTMLDivElement
  clear(): void
  renderSource(
    files: readonly SourceFile[],
    onFileSelect: FileSelectHandler,
    options?: SidebarRenderOptions,
  ): Promise<void>
}

type SidebarRenderOptions = {
  readonly selectedPath?: string
  readonly preserveExpandedPaths?: boolean
}

class SidebarController implements Sidebar {
  readonly element = el('div', { id: 'tree' })
  private readonly expandedDirectoryPaths = new Set<string>()

  clear(): void {
    this.expandedDirectoryPaths.clear()
    this.element.replaceChildren()
  }

  async renderSource(
    files: readonly SourceFile[],
    onFileSelect: FileSelectHandler,
    options?: SidebarRenderOptions,
  ): Promise<void> {
    const expandedPathsToRestore = options?.preserveExpandedPaths
      ? new Set(this.expandedDirectoryPaths)
      : new Set<string>()

    this.expandedDirectoryPaths.clear()
    this.element.replaceChildren()

    await renderTree(buildSourceTree(files), this.element, onFileSelect, {
      selectedPath: options?.selectedPath,
      expandedPaths: expandedPathsToRestore,
      onDirectoryToggle: this.setDirectoryOpen,
    })
  }

  private readonly setDirectoryOpen = (directoryPath: string, open: boolean): void => {
    setDirectoryOpen(this.expandedDirectoryPaths, directoryPath, open)
  }
}

export function createSidebar(): Sidebar {
  return new SidebarController()
}

function setDirectoryOpen(
  expandedDirectoryPaths: Set<string>,
  directoryPath: string,
  open: boolean,
): void {
  if (open) {
    expandedDirectoryPaths.add(directoryPath)
    return
  }

  expandedDirectoryPaths.delete(directoryPath)
  for (const path of expandedDirectoryPaths) {
    if (path.startsWith(directoryPath)) expandedDirectoryPaths.delete(path)
  }
}
