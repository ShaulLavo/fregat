import type { Editor } from '@singapore-editor/core/editor'
import type { DiffPlugin, DiffTextFile } from '@singapore-editor/diff'
import {
  documentUriToFileName,
  type TypeScriptLspDefinitionTarget,
  type TypeScriptLspWorkspaceEditRequest,
  type TypeScriptLspWorkspaceEditResult,
} from '@singapore-editor/typescript-lsp'
import type { Sidebar } from './components/sidebar.ts'
import type { StatusBar } from './components/statusBar.ts'
import type { TopBar } from './components/topBar.ts'
import {
  REPOSITORY_NAME,
  REPOSITORY_OWNER,
  type SourceEntry,
  type SourceFile,
  type SourceSnapshot,
} from './githubSource.ts'
import { SourceLoader } from './sourceLoader.ts'
import { findSourceEntry, firstSourceEntry } from './tree.ts'
import { applyTextEdits, offsetEdits, type OffsetEdit } from './workspaceEdits.ts'

const SELECTED_FILE_KEY = 'editor-selected-file'
const DEFAULT_SELECTED_FILE = 'README.md'

type SourceWorkspace = {
  upsertWorkspaceFiles(files: readonly Pick<SourceFile, 'path' | 'text'>[]): void
  clearWorkspaceFiles(): void
}

type SourceViewHosts = {
  showEditor(): void
  showDiff(): void
}

export class SourceController {
  private currentSnapshot: SourceSnapshot | null = null
  private readonly loader = new SourceLoader()
  private readonly loadedFiles = new Map<string, SourceFile>()
  private selectionRequest = 0
  private currentSelectedPath: string | undefined
  private isRefreshingSource = false
  private readonly topBar: TopBar
  private readonly sidebar: Sidebar
  private readonly statusBar: StatusBar
  private readonly editor: Editor
  private readonly sourceWorkspace: SourceWorkspace | null
  private readonly liveDiff: DiffPlugin | null
  private readonly viewHosts: SourceViewHosts | null
  private activeView: 'edit' | 'diff' = 'edit'

  constructor(
    topBar: TopBar,
    sidebar: Sidebar,
    statusBar: StatusBar,
    editor: Editor,
    sourceWorkspace: SourceWorkspace | null = null,
    liveDiff: DiffPlugin | null = null,
    viewHosts: SourceViewHosts | null = null,
  ) {
    this.topBar = topBar
    this.sidebar = sidebar
    this.statusBar = statusBar
    this.editor = editor
    this.sourceWorkspace = sourceWorkspace
    this.liveDiff = liveDiff
    this.viewHosts = viewHosts
    this.topBar.setHandlers({
      onEditMode: () => this.showEditMode(),
      onDiffMode: () => this.showDiffMode(),
    })
  }

  start(): void {
    window.addEventListener('pagehide', this.onPageHide)
    this.statusBar.clear()
    this.topBar.setMessage('Loading cached source')
    void this.loadCachedThenRefresh()
  }

  private readonly onPageHide = (event: PageTransitionEvent): void => {
    if (event.persisted) return
    this.selectionRequest += 1
    this.currentSnapshot = null
    this.loader.dispose()
    window.removeEventListener('pagehide', this.onPageHide)
  }

  updateStatus(state = this.editor.getState()): void {
    this.statusBar.update(this.currentSelectedPath, state)
  }

  openDefinition(target: TypeScriptLspDefinitionTarget): boolean {
    const snapshot = this.currentSnapshot
    if (!snapshot) return false

    const file = findSourceEntry(snapshot.files, target.path)
    if (!file) return false

    void this.displayFile(file, 'auto', target)
      .then((selected) => {
        if (selected) this.sidebar.selectPath(file.path)
      })
      .catch(() => undefined)

    return true
  }

  /**
   * Lands a rename or a code action: the open file through the editor, so it can be undone, and
   * every other file in the source list, which the language worker is then told about. Every
   * operation is checked before any lands, so a plan the demo cannot apply changes nothing.
   */
  readonly applyWorkspaceEdit = async (
    request: TypeScriptLspWorkspaceEditRequest,
  ): Promise<TypeScriptLspWorkspaceEditResult> => {
    const snapshot = this.currentSnapshot
    if (!snapshot) return failedEdit('NO_SOURCE', 'No source is loaded to edit.')

    const openEdits: OffsetEdit[] = []
    const changed = new Map<string, SourceFile>()
    for (const operation of request.plan.operations) {
      if (operation.kind !== 'text-document') {
        return failedEdit('UNSUPPORTED', `The demo cannot ${operation.kind} files.`)
      }
      const path = sourcePathForUri(operation.uri)
      if (path === this.currentSelectedPath) {
        openEdits.push(...offsetEdits(this.editor.getTextSnapshot(), operation.edits))
        continue
      }
      const file = changed.get(path) ?? this.loadedFiles.get(path)
      if (!file) return failedEdit('MISSING_FILE', `${path} is still loading. Try the edit again.`)
      changed.set(path, { ...file, text: applyTextEdits(file.text, operation.edits) })
    }

    if (openEdits.length > 0) this.editor.edit(openEdits)
    this.replaceFiles(Array.from(changed.values()))
    return { status: 'applied' }
  }

  async refreshSource(): Promise<void> {
    if (this.isRefreshingSource) return

    this.isRefreshingSource = true
    this.updateToolbarState()
    this.topBar.setMessage(`Fetching ${REPOSITORY_OWNER}/${REPOSITORY_NAME}`)

    try {
      const snapshot = await this.loader.refreshSnapshot(this.currentSnapshot)
      if (this.currentSnapshot?.commitSha !== snapshot.commitSha) {
        this.displaySnapshot(snapshot, {
          selectedPath: this.currentSelectedPath ?? storedSelectedPath(),
          preserveExpandedPaths: Boolean(this.currentSnapshot),
        })
      }
      this.topBar.setRepositoryName(snapshotLabel(snapshot))
    } catch {
      this.handleRefreshFailure()
    } finally {
      this.isRefreshingSource = false
      this.updateToolbarState()
    }
  }

  private async loadCachedThenRefresh(): Promise<void> {
    const cached = await this.loader.cachedSnapshot()

    if (cached) {
      this.displaySnapshot(cached, {
        selectedPath: storedSelectedPath(),
        preserveExpandedPaths: false,
      })
      this.topBar.setRepositoryName(`${snapshotLabel(cached)} cached`)
    }

    await this.refreshSource()
  }

  private displaySnapshot(
    snapshot: SourceSnapshot,
    options: { readonly selectedPath?: string; readonly preserveExpandedPaths: boolean },
  ): void {
    const selectedFile = selectedFileForSnapshot(snapshot, options.selectedPath)
    this.selectionRequest += 1
    this.currentSnapshot = snapshot
    this.loadedFiles.clear()
    this.sourceWorkspace?.clearWorkspaceFiles()

    if (!selectedFile) {
      this.clearActiveFile()
      this.sidebar.clear()
      return
    }

    void this.sidebar
      .renderSource(snapshot.files, this.displayFile, {
        selectedPath: selectedFile.path,
        preserveExpandedPaths: options.preserveExpandedPaths,
        onFileHover: this.preloadFile,
      })
      .then(() => this.fillInBackground(snapshot))
  }

  private readonly displayFile = async (
    entry: SourceEntry,
    reason: 'auto' | 'user',
    target?: TypeScriptLspDefinitionTarget,
  ): Promise<boolean> => {
    const snapshot = this.currentSnapshot
    if (!snapshot) return false
    const request = ++this.selectionRequest
    if (
      this.loadedFiles.has(entry.path) &&
      this.currentSelectedPath === entry.path &&
      this.editor.getState().documentId === entry.path
    ) {
      const file = this.currentFile()
      if (target && file) this.revealDefinition(file, target)
      if (reason === 'user') this.editor.focus()
      this.topBar.setFileStatus('')
      return true
    }
    this.topBar.setFileStatus(`Loading ${entry.path}…`)
    try {
      const file = await this.loadFile(snapshot, entry)
      if (request !== this.selectionRequest || this.currentSnapshot !== snapshot) return false
      this.keepActiveFileEdits()
      this.currentSelectedPath = file.path
      localStorage.setItem(SELECTED_FILE_KEY, file.path)
      this.editor.openDocument({
        documentId: file.path,
        text: file.text,
        languageId: languageIdForFilePath(file.path),
      })
      if (target) this.revealDefinition(file, target)
      if (this.activeView === 'diff') this.configureCurrentLiveDiff()
      if (reason === 'user') this.editor.focus()
      this.updateStatus()
      this.topBar.setFileStatus('')
      return true
    } catch (error) {
      if (request === this.selectionRequest)
        this.topBar.setFileStatus(`Could not load ${entry.path}. Select it to retry.`)
      throw error
    }
  }

  private revealDefinition(file: SourceFile, target: TypeScriptLspDefinitionTarget): void {
    const start = offsetForPosition(file.text, target.range.start)
    const end = offsetForPosition(file.text, target.range.end)
    this.editor.setSelection(start, end, { revealOffset: start })
  }

  private async loadFile(snapshot: SourceSnapshot, entry: SourceEntry): Promise<SourceFile> {
    const loaded = this.loadedFiles.get(entry.path)
    if (this.currentSnapshot === snapshot && loaded) return loaded
    const file = await this.loader.loadFile(snapshot, entry)
    if (this.currentSnapshot !== snapshot) return file
    // A preload can finish after the same file was opened and edited.
    const current = this.loadedFiles.get(entry.path)
    if (current) return current
    this.loadedFiles.set(file.path, file)
    this.sourceWorkspace?.upsertWorkspaceFiles([file])
    return file
  }

  private readonly preloadFile = (entry: SourceEntry): void => {
    const snapshot = this.currentSnapshot
    if (!snapshot || this.loader.preloadsBusy()) return
    void this.loadFile(snapshot, entry).catch(() => undefined)
  }

  private async fillInBackground(snapshot: SourceSnapshot): Promise<void> {
    const entries = snapshot.files.values()
    await Promise.all([this.fillFiles(snapshot, entries), this.fillFiles(snapshot, entries)])
  }

  private async fillFiles(
    snapshot: SourceSnapshot,
    entries: IterableIterator<SourceEntry>,
  ): Promise<void> {
    for (const entry of entries) {
      if (this.currentSnapshot !== snapshot) return
      try {
        await this.loadFile(snapshot, entry)
      } catch {
        // A failed preload remains available for an explicit click to retry.
      }
    }
  }

  /** The file being left keeps its edits, and the worker reads them once the file is closed. */
  private keepActiveFileEdits(): void {
    const file = this.currentFile()
    if (!file || this.editor.getState().documentId !== file.path) return

    const text = this.editor.materializeFullText()
    if (text !== file.text) this.replaceFiles([{ ...file, text }])
  }

  private replaceFiles(files: readonly SourceFile[]): void {
    const snapshot = this.currentSnapshot
    if (!snapshot || files.length === 0) return

    for (const file of files) this.loadedFiles.set(file.path, file)
    this.sourceWorkspace?.upsertWorkspaceFiles(files)
  }

  private showEditMode(): void {
    this.activeView = 'edit'
    this.liveDiff?.setEnabled(false)
    this.viewHosts?.showEditor()
    this.topBar.setViewMode('edit')
    this.editor.focus()
  }

  private showDiffMode(): void {
    if (!this.configureCurrentLiveDiff()) return

    this.activeView = 'diff'
    this.liveDiff?.setEnabled(true)
    this.viewHosts?.showDiff()
    this.topBar.setViewMode('diff')
    this.editor.focus()
  }

  private configureCurrentLiveDiff(): boolean {
    const liveDiff = this.liveDiff
    const file = this.currentFile()
    if (!liveDiff || !file) return false

    liveDiff.setBaseFile(diffBaseFile(file))
    return true
  }

  private currentFile(): SourceFile | null {
    const snapshot = this.currentSnapshot
    if (!snapshot || !this.currentSelectedPath) return null
    return this.loadedFiles.get(this.currentSelectedPath) ?? null
  }

  private handleRefreshFailure(): void {
    if (this.currentSnapshot) {
      this.topBar.setMessage('Using cached source; refresh failed')
      return
    }

    this.topBar.setMessage('Failed to fetch source')
    this.clearActiveFile()
    this.sidebar.clear()
  }

  private updateToolbarState(): void {
    this.topBar.setBusyState(this.isRefreshingSource)
  }

  private clearActiveFile(): void {
    this.currentSelectedPath = undefined
    this.sourceWorkspace?.clearWorkspaceFiles()
    this.liveDiff?.setBaseFile(null)
    this.liveDiff?.setEnabled(false)
    this.editor.clearDocument()
    this.updateStatus()
  }
}

function failedEdit(code: string, message: string): TypeScriptLspWorkspaceEditResult {
  return { status: 'failed', code, message }
}

function sourcePathForUri(uri: string): string {
  return (documentUriToFileName(uri) ?? uri).replace(/^\//, '')
}

function diffBaseFile(file: SourceFile): DiffTextFile {
  return {
    path: file.path,
    text: file.text,
    languageId: languageIdForFilePath(file.path),
    objectId: file.sha,
  }
}

function selectedFileForSnapshot(
  snapshot: SourceSnapshot,
  selectedPath: string | undefined,
): SourceEntry | null {
  return (
    findSourceEntry(snapshot.files, selectedPath) ??
    findSourceEntry(snapshot.files, DEFAULT_SELECTED_FILE) ??
    firstSourceEntry(snapshot.files)
  )
}

function storedSelectedPath(): string | undefined {
  return localStorage.getItem(SELECTED_FILE_KEY) ?? undefined
}

function snapshotLabel(snapshot: SourceSnapshot): string {
  return `${snapshot.owner}/${snapshot.repo} @ ${snapshot.commitSha.slice(0, 7)}`
}

function languageIdForFilePath(filePath: string): string | null {
  const extension = extensionForFilePath(filePath)
  if (!extension) return null

  return LANGUAGE_BY_EXTENSION[extension] ?? null
}

function extensionForFilePath(filePath: string): string | null {
  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex === -1) return null

  return filePath.slice(dotIndex).toLowerCase()
}

function offsetForPosition(
  text: string,
  position: { readonly line: number; readonly character: number },
): number {
  const lines = text.split('\n')
  const line = Math.min(Math.max(0, position.line), Math.max(0, lines.length - 1))
  let offset = 0
  for (let index = 0; index < line; index += 1) offset += (lines[index]?.length ?? 0) + 1
  return Math.min(text.length, offset + Math.max(0, position.character))
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.cjs': 'javascript',
  '.css': 'css',
  '.cts': 'typescript',
  '.htm': 'html',
  '.html': 'html',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'javascript',
  '.markdown': 'markdown',
  '.md': 'markdown',
  '.mjs': 'javascript',
  '.mts': 'typescript',
  '.ts': 'typescript',
  '.tsx': 'tsx',
}
