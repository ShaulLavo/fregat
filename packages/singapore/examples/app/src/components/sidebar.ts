import type { SourceEntry } from '../githubSource.ts'
import { buildSourceTree, renderTree, type FileSelectHandler } from '../tree.ts'
import { el } from './dom.ts'

export type Sidebar = {
  readonly element: HTMLDivElement
  clear(): void
  selectPath(path: string): void
  renderSource(
    files: readonly SourceEntry[],
    onFileSelect: FileSelectHandler,
    options?: SidebarRenderOptions,
  ): Promise<void>
}

type SidebarRenderOptions = {
  readonly selectedPath?: string
  readonly preserveExpandedPaths?: boolean
  readonly onFileHover?: (file: SourceEntry) => void
}

class SidebarController implements Sidebar {
  readonly element = el('div', { id: 'tree' })
  private readonly expandedDirectoryPaths = new Set<string>()

  clear(): void {
    this.expandedDirectoryPaths.clear()
    this.element.replaceChildren()
  }

  selectPath(path: string): void {
    const parts = path.split('/')
    let directory = ''
    for (const part of parts.slice(0, -1)) {
      directory += `${part}/`
      const entry = Array.from(
        this.element.querySelectorAll<HTMLButtonElement>('.entry.directory'),
      ).find((row) => row.dataset.sourcePath === directory)
      if (entry?.getAttribute('aria-expanded') === 'false') entry.click()
    }
    for (const entry of this.element.querySelectorAll<HTMLElement>('.entry.file')) {
      entry.classList.toggle('active', entry.dataset.sourcePath === path)
    }
  }

  async renderSource(
    files: readonly SourceEntry[],
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
      onFileHover: options?.onFileHover,
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
