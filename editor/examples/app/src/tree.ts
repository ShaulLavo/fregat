import type { SourceFile } from './githubSource.ts'

export type SourceTreeEntry =
  | {
      readonly name: string
      readonly path: string
      readonly kind: 'file'
      readonly file: SourceFile
    }
  | {
      readonly name: string
      readonly path: string
      readonly kind: 'directory'
      readonly children: readonly SourceTreeEntry[]
    }

type FileSelectReason = 'auto' | 'user'
export type FileSelectHandler = (file: SourceFile, reason: FileSelectReason) => Promise<void> | void
type DirectoryToggleHandler = (directoryPath: string, open: boolean) => void

type RenderTreeOptions = {
  readonly selectedPath?: string
  readonly expandedPaths?: ReadonlySet<string>
  readonly onDirectoryToggle?: DirectoryToggleHandler
}

type DirectoryEntryOptions = RenderTreeOptions & {
  readonly shouldRestore: boolean
}

type MutableDirectory = {
  readonly name: string
  readonly path: string
  readonly directories: Map<string, MutableDirectory>
  readonly files: Map<string, SourceFile>
}

export function buildSourceTree(files: readonly SourceFile[]): readonly SourceTreeEntry[] {
  const root = createMutableDirectory('', '')

  for (const file of files) {
    addSourceFile(root, file)
  }

  return directoryChildren(root)
}

export function firstSourceFile(files: readonly SourceFile[]): SourceFile | null {
  return files.toSorted((left, right) => left.path.localeCompare(right.path))[0] ?? null
}

export function findSourceFile(
  files: readonly SourceFile[],
  path: string | undefined,
): SourceFile | null {
  if (!path) return null
  return files.find((file) => file.path === path) ?? null
}

export async function renderTree(
  entries: readonly SourceTreeEntry[],
  container: HTMLElement,
  onFileSelect: FileSelectHandler,
  options?: RenderTreeOptions,
): Promise<void> {
  const ul = document.createElement('ul')

  for (const entry of entries) {
    await appendTreeEntry(ul, entry, onFileSelect, options)
  }

  container.appendChild(ul)
}

function createMutableDirectory(name: string, path: string): MutableDirectory {
  return {
    name,
    path,
    directories: new Map(),
    files: new Map(),
  }
}

function addSourceFile(root: MutableDirectory, file: SourceFile): void {
  const parts = file.path.split('/')
  const fileName = parts.at(-1)
  if (!fileName) return

  const directory = ensureDirectory(root, parts.slice(0, -1))
  directory.files.set(fileName, file)
}

function ensureDirectory(root: MutableDirectory, parts: readonly string[]): MutableDirectory {
  let current = root

  for (const part of parts) {
    current = ensureChildDirectory(current, part)
  }

  return current
}

function ensureChildDirectory(parent: MutableDirectory, name: string): MutableDirectory {
  const existing = parent.directories.get(name)
  if (existing) return existing

  const path = parent.path ? `${parent.path}${name}/` : `${name}/`
  const directory = createMutableDirectory(name, path)
  parent.directories.set(name, directory)
  return directory
}

function directoryChildren(directory: MutableDirectory): readonly SourceTreeEntry[] {
  const directories = Array.from(directory.directories.values())
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map(directoryEntry)
  const files = Array.from(directory.files.entries())
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, file]) => fileEntry(name, file))

  return directories.concat(files)
}

function directoryEntry(directory: MutableDirectory): SourceTreeEntry {
  return {
    name: directory.name,
    path: directory.path,
    kind: 'directory',
    children: directoryChildren(directory),
  }
}

function fileEntry(name: string, file: SourceFile): SourceTreeEntry {
  return {
    name,
    path: file.path,
    kind: 'file',
    file,
  }
}

async function appendTreeEntry(
  ul: HTMLUListElement,
  entry: SourceTreeEntry,
  onFileSelect: FileSelectHandler,
  options?: RenderTreeOptions,
): Promise<void> {
  if (entry.kind === 'directory') {
    await appendDirectoryEntry(ul, entry, onFileSelect, options)
    return
  }

  await appendFileEntry(ul, entry, onFileSelect, options?.selectedPath === entry.path)
}

function appendDirectoryEntry(
  ul: HTMLUListElement,
  entry: SourceTreeEntry & { readonly kind: 'directory' },
  onFileSelect: FileSelectHandler,
  options?: RenderTreeOptions,
): Promise<void> {
  const shouldRestore = shouldRestoreDirectory(entry, options)
  const { li, restore } = renderDirectoryEntry(entry, onFileSelect, {
    selectedPath: options?.selectedPath,
    expandedPaths: options?.expandedPaths,
    onDirectoryToggle: options?.onDirectoryToggle,
    shouldRestore,
  })

  return appendRenderedEntry(ul, li, restore)
}

function shouldRestoreDirectory(
  entry: SourceTreeEntry & { readonly kind: 'directory' },
  options?: RenderTreeOptions,
): boolean {
  if (options?.expandedPaths?.has(entry.path)) return true
  return options?.selectedPath?.startsWith(entry.path) ?? false
}

function renderDirectoryEntry(
  entry: SourceTreeEntry & { readonly kind: 'directory' },
  onFileSelect: FileSelectHandler,
  options: DirectoryEntryOptions,
): { li: HTMLLIElement; restore: Promise<void> | null } {
  const li = document.createElement('li')
  const label = document.createElement('span')
  label.className = 'entry directory'
  label.textContent = '📁 ' + entry.name

  let loaded = false
  let open = false
  const childContainer = document.createElement('div')
  childContainer.style.display = 'none'

  const setOpen = (nextOpen: boolean) => {
    open = nextOpen
    childContainer.style.display = nextOpen ? '' : 'none'
    label.textContent = (nextOpen ? '📂 ' : '📁 ') + entry.name
  }

  const expand = async () => {
    if (!loaded) {
      await renderTree(entry.children, childContainer, onFileSelect, options)
      loaded = true
    }

    setOpen(true)
    options.onDirectoryToggle?.(entry.path, true)
  }

  const collapse = () => {
    setOpen(false)
    options.onDirectoryToggle?.(entry.path, false)
  }

  const toggle = async () => {
    if (open) {
      collapse()
      return
    }

    await expand()
  }

  label.addEventListener('click', () => {
    void markErrors(label, toggle())
  })

  li.append(label, childContainer)

  const restore = options.shouldRestore ? expand() : null
  return { li, restore }
}

function appendFileEntry(
  ul: HTMLUListElement,
  entry: SourceTreeEntry & { readonly kind: 'file' },
  onFileSelect: FileSelectHandler,
  autoSelect: boolean,
): Promise<void> {
  const { li, restore } = renderFileEntry(entry, onFileSelect, autoSelect)
  return appendRenderedEntry(ul, li, restore)
}

function renderFileEntry(
  entry: SourceTreeEntry & { readonly kind: 'file' },
  onFileSelect: FileSelectHandler,
  autoSelect: boolean,
): { li: HTMLLIElement; restore: Promise<void> | null } {
  const li = document.createElement('li')
  const label = document.createElement('span')
  label.className = 'entry file'
  label.textContent = '📄 ' + entry.name

  const selectFile = async (reason: FileSelectReason) => {
    document.querySelectorAll('.entry.active').forEach((el) => el.classList.remove('active'))
    label.classList.add('active')
    await onFileSelect(entry.file, reason)
  }

  label.addEventListener('click', () => {
    void markErrors(label, selectFile('user'))
  })
  li.appendChild(label)

  const restore = autoSelect ? selectFile('auto') : null
  return { li, restore }
}

async function markErrors(label: HTMLElement, action: Promise<void>): Promise<void> {
  try {
    await action
  } catch {
    label.classList.add('error')
  }
}

async function appendRenderedEntry(
  ul: HTMLUListElement,
  li: HTMLLIElement,
  restore: Promise<void> | null,
): Promise<void> {
  ul.appendChild(li)
  if (!restore) return
  await restore
}
