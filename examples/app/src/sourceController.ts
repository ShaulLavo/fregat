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
  fetchRepositoryRef,
  fetchRepositorySource,
  REPOSITORY_NAME,
  REPOSITORY_OWNER,
  type SourceFile,
  type SourceSnapshot,
} from './githubSource.ts'
import { loadCachedSourceSnapshot, saveSourceSnapshotToCache } from './sourceCache.ts'
import { findSourceFile, firstSourceFile } from './tree.ts'
import { applyTextEdits, offsetEdits, type OffsetEdit } from './workspaceEdits.ts'

const SELECTED_FILE_KEY = 'editor-selected-file'
const DEFAULT_SELECTED_FILE = 'README.md'

type SourceWorkspace = {
  setWorkspaceFiles(files: readonly Pick<SourceFile, 'path' | 'text'>[]): void
  upsertWorkspaceFiles(files: readonly Pick<SourceFile, 'path' | 'text'>[]): void
  clearWorkspaceFiles(): void
}

type SourceViewHosts = {
  showEditor(): void
  showDiff(): void
}

export class SourceController {
  private currentSnapshot: SourceSnapshot | null = null
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
    this.statusBar.clear()
    this.topBar.setMessage('Loading cached source')
    void this.loadCachedThenRefresh()
  }

  updateStatus(state = this.editor.getState()): void {
    this.statusBar.update(this.currentSelectedPath, state)
  }

  openDefinition(target: TypeScriptLspDefinitionTarget): boolean {
    const snapshot = this.currentSnapshot
    if (!snapshot) return false

    const file = findSourceFile(snapshot.files, target.path)
    if (!file) return false

    this.displayFile(file, 'auto')
    const start = offsetForPosition(file.text, target.range.start)
    const end = offsetForPosition(file.text, target.range.end)
    this.editor.setSelection(start, end, { revealOffset: start })
    void this.sidebar.renderSource(snapshot.files, this.displayFile, {
      selectedPath: file.path,
      preserveExpandedPaths: true,
    })
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
      const file = changed.get(path) ?? findSourceFile(snapshot.files, path)
      if (!file) return failedEdit('MISSING_FILE', `${path} is not in the source list.`)
      changed.set(path, { ...file, text: applyTextEdits(file.text, operation.edits) })
    }

    if (openEdits.length > 0) this.editor.edit(openEdits)
    this.replaceFiles([...changed.values()])
    return { status: 'applied' }
  }

  async refreshSource(): Promise<void> {
    if (this.isRefreshingSource) return

    this.isRefreshingSource = true
    this.updateToolbarState()
    this.topBar.setMessage(`Fetching ${REPOSITORY_OWNER}/${REPOSITORY_NAME}`)

    try {
      const sourceRef = await fetchRepositoryRef()
      if (this.currentSnapshot?.commitSha === sourceRef.commitSha) {
        this.topBar.setRepositoryName(snapshotLabel(this.currentSnapshot))
        return
      }

      const snapshot = await fetchRepositorySource(sourceRef)
      await persistSnapshot(snapshot)
      await this.displaySnapshot(snapshot, {
        selectedPath: this.currentSelectedPath ?? storedSelectedPath(),
        preserveExpandedPaths: Boolean(this.currentSnapshot),
      })
      this.topBar.setRepositoryName(snapshotLabel(snapshot))
    } catch {
      this.handleRefreshFailure()
    } finally {
      this.isRefreshingSource = false
      this.updateToolbarState()
    }
  }

  private async loadCachedThenRefresh(): Promise<void> {
    const cached = await loadCachedSourceSnapshot()

    if (cached) {
      await this.displaySnapshot(cached, {
        selectedPath: storedSelectedPath(),
        preserveExpandedPaths: false,
      })
      this.topBar.setRepositoryName(`${snapshotLabel(cached)} cached`)
    }

    await this.refreshSource()
  }

  private async displaySnapshot(
    snapshot: SourceSnapshot,
    options: { readonly selectedPath?: string; readonly preserveExpandedPaths: boolean },
  ): Promise<void> {
    const selectedFile = selectedFileForSnapshot(snapshot, options.selectedPath)
    this.currentSnapshot = snapshot
    this.currentSelectedPath = selectedFile?.path
    this.sourceWorkspace?.setWorkspaceFiles(snapshot.files)

    if (!selectedFile) {
      this.clearActiveFile()
      this.sidebar.clear()
      return
    }

    await this.sidebar.renderSource(snapshot.files, this.displayFile, {
      selectedPath: selectedFile.path,
      preserveExpandedPaths: options.preserveExpandedPaths,
    })
  }

  private readonly displayFile = (listed: SourceFile, reason: 'auto' | 'user'): void => {
    this.keepActiveFileEdits()
    // The sidebar holds the file as it was listed; an edit since then lives in the snapshot.
    const file = findSourceFile(this.currentSnapshot?.files ?? [], listed.path) ?? listed
    this.currentSelectedPath = file.path
    localStorage.setItem(SELECTED_FILE_KEY, file.path)
    this.editor.openDocument({
      documentId: file.path,
      text: file.text,
      languageId: languageIdForFilePath(file.path),
    })
    if (this.activeView === 'diff') this.configureCurrentLiveDiff()
    if (reason === 'user') this.editor.focus()
    this.updateStatus()
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

    const byPath = new Map(files.map((file) => [file.path, file]))
    this.currentSnapshot = {
      ...snapshot,
      files: snapshot.files.map((file) => byPath.get(file.path) ?? file),
    }
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
    return findSourceFile(snapshot.files, this.currentSelectedPath)
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
): SourceFile | null {
  return (
    findSourceFile(snapshot.files, selectedPath) ??
    findSourceFile(snapshot.files, DEFAULT_SELECTED_FILE) ??
    firstSourceFile(snapshot.files)
  )
}

async function persistSnapshot(snapshot: SourceSnapshot): Promise<void> {
  try {
    await saveSourceSnapshotToCache(snapshot)
  } catch {
    return
  }
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
