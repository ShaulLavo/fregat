import type { SourceEntry } from './githubSource.ts'

export type SourceTreeEntry =
  | {
      readonly name: string
      readonly path: string
      readonly kind: 'file'
      readonly file: SourceEntry
    }
  | {
      readonly name: string
      readonly path: string
      readonly kind: 'directory'
      readonly children: readonly SourceTreeEntry[]
    }

type FileSelectReason = 'auto' | 'user'
export type FileSelectHandler = (
  file: SourceEntry,
  reason: FileSelectReason,
) => Promise<boolean | void> | boolean | void
type DirectoryToggleHandler = (directoryPath: string, open: boolean) => void

type RenderTreeOptions = {
  readonly selectedPath?: string
  readonly expandedPaths?: ReadonlySet<string>
  readonly onDirectoryToggle?: DirectoryToggleHandler
  readonly onFileHover?: (file: SourceEntry) => void
  readonly selection?: { request: number }
}

type DirectoryEntryOptions = RenderTreeOptions & {
  readonly shouldRestore: boolean
}

type MutableDirectory = {
  readonly name: string
  readonly path: string
  readonly directories: Map<string, MutableDirectory>
  readonly files: Map<string, SourceEntry>
}

export function buildSourceTree(files: readonly SourceEntry[]): readonly SourceTreeEntry[] {
  const root = createMutableDirectory('', '')

  for (const file of files) {
    addSourceEntry(root, file)
  }

  return directoryChildren(root)
}

export function firstSourceEntry(files: readonly SourceEntry[]): SourceEntry | null {
  return files.toSorted((left, right) => left.path.localeCompare(right.path))[0] ?? null
}

export function findSourceEntry(
  files: readonly SourceEntry[],
  path: string | undefined,
): SourceEntry | null {
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
  container.appendChild(ul)
  const sharedOptions = { ...options, selection: options?.selection ?? { request: 0 } }
  const restores = entries.map((entry) => appendTreeEntry(ul, entry, onFileSelect, sharedOptions))
  await Promise.all(restores)
}

function createMutableDirectory(name: string, path: string): MutableDirectory {
  return {
    name,
    path,
    directories: new Map(),
    files: new Map(),
  }
}

function addSourceEntry(root: MutableDirectory, file: SourceEntry): void {
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
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(directoryEntry)
  const files = Array.from(directory.files.entries())
    .sort(([left], [right]) => left.localeCompare(right))
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

function fileEntry(name: string, file: SourceEntry): SourceTreeEntry {
  return {
    name,
    path: file.path,
    kind: 'file',
    file,
  }
}

function appendTreeEntry(
  ul: HTMLUListElement,
  entry: SourceTreeEntry,
  onFileSelect: FileSelectHandler,
  options?: RenderTreeOptions,
): Promise<void> {
  if (entry.kind === 'directory') {
    return appendDirectoryEntry(ul, entry, onFileSelect, options)
  }

  return appendFileEntry(ul, entry, onFileSelect, options)
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
    onFileHover: options?.onFileHover,
    selection: options?.selection,
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
  const label = document.createElement('button')
  label.type = 'button'
  label.title = entry.path
  label.dataset.sourcePath = entry.path
  label.className = 'entry directory'
  label.textContent = '📁 ' + entry.name
  label.setAttribute('aria-expanded', 'false')

  let loaded = false
  let open = false
  const childContainer = document.createElement('div')
  childContainer.style.display = 'none'

  const setOpen = (nextOpen: boolean) => {
    open = nextOpen
    childContainer.style.display = nextOpen ? '' : 'none'
    label.textContent = (nextOpen ? '📂 ' : '📁 ') + entry.name
    label.setAttribute('aria-expanded', String(nextOpen))
  }

  const expand = async () => {
    setOpen(true)
    options.onDirectoryToggle?.(entry.path, true)
    if (loaded) return
    loaded = true
    await renderTree(entry.children, childContainer, onFileSelect, options)
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
  options?: RenderTreeOptions,
): Promise<void> {
  const { li, restore } = renderFileEntry(entry, onFileSelect, options)
  return appendRenderedEntry(ul, li, restore)
}

function renderFileEntry(
  entry: SourceTreeEntry & { readonly kind: 'file' },
  onFileSelect: FileSelectHandler,
  options?: RenderTreeOptions,
): { li: HTMLLIElement; restore: Promise<void> | null } {
  const li = document.createElement('li')
  const label = document.createElement('button')
  label.type = 'button'
  label.title = entry.path
  label.dataset.sourcePath = entry.path
  label.className = 'entry file'
  label.textContent = '📄 ' + entry.name

  const selection = options?.selection ?? { request: 0 }
  const selectFile = async (reason: FileSelectReason) => {
    const request = ++selection.request
    label.classList.remove('error')
    label.setAttribute('aria-busy', 'true')
    try {
      const selected = await onFileSelect(entry.file, reason)
      if (selection.request !== request || selected === false) return
      containerFor(label)
        .querySelectorAll('.entry.active')
        .forEach((el) => el.classList.remove('active'))
      label.classList.add('active')
    } finally {
      label.setAttribute('aria-busy', 'false')
    }
  }
  label.addEventListener('pointerenter', () => options?.onFileHover?.(entry.file))
  label.addEventListener('focus', () => options?.onFileHover?.(entry.file))

  label.addEventListener('click', () => {
    void markErrors(label, selectFile('user'))
  })
  li.appendChild(label)

  const restore =
    options?.selectedPath === entry.path ? markErrors(label, selectFile('auto')) : null
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

function containerFor(label: HTMLElement): Element {
  return label.closest('#tree') ?? label.closest('ul')?.parentElement ?? label
}
