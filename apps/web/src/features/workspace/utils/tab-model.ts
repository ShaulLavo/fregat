import type { GitFileStatus } from '@workspace/contracts'
import type {
  EditorTabConflictMap,
  EditorTabDiffSource,
  EditorTabModel,
} from '@/features/workspace/utils/tab-types'
import { gitStatusSymbol, type GitSymbolSource } from '@/features/git/utils/status-symbols'

import { iconForEntry } from '@/lib/file-icons'
import { basename } from '@/lib/path-formatters'
import { documentSourcePath } from '@/lib/documents/utils/capabilities'
import {
  comparisonShortHash,
  tabCopyPath,
  tabIconName,
  tabLabel,
  tabTitle,
} from '@/lib/documents/utils/labels'
import type {
  EditorTabRecord,
  GitComparison,
  TabContent,
  TabId,
  WorkspaceRoot,
} from '@/lib/documents/utils/types'

export const EMPTY_GIT_FILES: readonly GitFileStatus[] = []

export type EditorSplitDirection = 'horizontal' | 'vertical'
export type EditorSnapZone = 'bottom' | 'center' | 'left' | 'right' | 'top'
export type EditorSplitScope = 'pane' | 'root'

export function editorTabModel({
  conflicts,
  gitFiles,
  rootPath,
  selectedTabId,
  tab,
}: {
  conflicts: EditorTabConflictMap
  gitFiles: readonly GitFileStatus[]
  rootPath: WorkspaceRoot
  selectedTabId: TabId | null
  tab: EditorTabRecord
}): EditorTabModel {
  const content = tab.content
  const diffChange = tabDiffChange(content, gitFiles, rootPath)
  const diffStatus = diffChange ? gitStatusSymbol(diffChange.status, diffChange.source) : null
  const diffHash =
    content.kind === 'document' && content.document.kind === 'git-diff'
      ? comparisonShortHash(content.document.source)
      : ''
  const facts = { conflictPath: conflictForTab(content, conflicts)?.remotePath }
  const copyPath = tabCopyPath(content, facts)

  return {
    active: tab.id === selectedTabId,
    content,
    copyPath,
    copyRelativePath: tabRelativeCopyPath(copyPath, rootPath),
    diffSource: tabDiffSource(content, conflicts, diffChange),
    diffStatus,
    diffSuffix: tabDiffSuffix(diffHash, diffStatus?.label),
    id: tab.id,
    icon: iconForEntry({ name: tabIconName(content, facts), type: 'file' }),
    name: tabLabel(content, facts),
    title: tabTitle(content, facts),
  }
}

function tabRelativeCopyPath(path: string, rootPath: string) {
  const normalizedPath = normalizedCopyPath(path)
  const normalizedRoot = normalizedCopyPath(rootPath)
  if (!normalizedRoot) return normalizedPath
  if (normalizedPath === normalizedRoot) return basename(normalizedPath)

  const rootPrefix = `${normalizedRoot}/`
  if (!normalizedPath.startsWith(rootPrefix)) return normalizedPath

  return normalizedPath.slice(rootPrefix.length)
}

function normalizedCopyPath(path: string) {
  if (path === '/') return path

  return path.replace(/\/+$/u, '')
}

type TabDiffChange = {
  source: GitSymbolSource
  status: GitFileStatus['index'] | GitFileStatus['worktree']
}

function tabDiffChange(
  content: TabContent,
  files: readonly GitFileStatus[],
  rootPath: string,
): TabDiffChange | null {
  if (content.kind !== 'document' || content.document.kind !== 'git-diff') return null
  const diff = content.document.source

  const file = files.find((file) => diffStatusMatchesFile(diff, file, rootPath))
  const live = file ? liveChangeForDiff(diff, file) : null
  if (live) return live
  if (diff.kind !== 'snapshot' || !diff.status) return null

  return { source: 'historical', status: diff.status }
}

function tabDiffSource(
  content: TabContent,
  conflicts: EditorTabConflictMap,
  change: TabDiffChange | null,
): EditorTabDiffSource | null {
  const conflict = conflictForTab(content, conflicts)
  if (conflict) return { onDisk: true, path: conflict.remotePath }
  if (content.kind !== 'document' || content.document.kind !== 'git-diff') return null
  const path = documentSourcePath(content.document)
  if (path === null) return null
  return { onDisk: change?.status !== 'deleted', path }
}

function conflictForTab(content: TabContent, conflicts: EditorTabConflictMap) {
  if (content.kind !== 'document' || content.document.kind !== 'conflict') return null
  return conflicts[content.document.conflictId] ?? null
}

function tabDiffSuffix(hash: string, status: string | undefined) {
  if (!hash) return ''
  if (!status) return `(${hash})`

  return `(${hash} ${status})`
}

function diffStatusMatchesFile(diff: GitComparison, file: GitFileStatus, rootPath: string) {
  return pathSetsOverlap(diffStatusPaths(diff), statusPaths(file), rootPath)
}

function liveChangeForDiff(diff: GitComparison, file: GitFileStatus): TabDiffChange | null {
  const preferred = diff.kind === 'snapshot' ? diff.source : undefined
  const source = liveSymbolSource(file, preferred)
  if (!source) return null

  return { source, status: statusForSymbolSource(file, source) }
}

function liveSymbolSource(
  file: GitFileStatus,
  preferred: GitSymbolSource | undefined,
): GitSymbolSource | null {
  if (preferred === 'staged' && isStagedStatus(file.index)) return 'staged'
  if (preferred === 'worktree' && isWorktreeStatus(file.worktree)) return 'worktree'
  if (isStagedStatus(file.index)) return 'staged'
  if (isWorktreeStatus(file.worktree)) return 'worktree'

  return null
}

function statusForSymbolSource(file: GitFileStatus, source: GitSymbolSource) {
  if (source === 'staged') return file.index
  if (source === 'worktree') return file.worktree

  return file.status
}

function isStagedStatus(status: GitFileStatus['index']) {
  return status !== 'unmodified' && status !== 'untracked'
}

function isWorktreeStatus(status: GitFileStatus['worktree']) {
  return status !== 'unmodified'
}

function diffStatusPaths(diff: GitComparison) {
  return [documentSourcePath({ kind: 'git-diff', source: diff }), diff.oldPath].filter(
    isPresentPath,
  )
}

function statusPaths(file: GitFileStatus) {
  return [file.path, file.oldPath].filter(isPresentPath)
}

function isPresentPath<T extends string>(path: T | null | undefined): path is T {
  return Boolean(path)
}

function pathSetsOverlap(left: readonly string[], right: readonly string[], rootPath: string) {
  const normalizedRight = new Set(right.flatMap((path) => comparablePaths(path, rootPath)))

  return left.some((path) =>
    comparablePaths(path, rootPath).some((candidate) => normalizedRight.has(candidate)),
  )
}

function comparablePaths(path: string, rootPath: string) {
  const normalized = normalizePath(path)
  const root = normalizePath(rootPath)
  const paths = [normalized, stripLeadingSlash(normalized)]
  const rootPrefix = `${root}/`

  if (root && normalized.startsWith(rootPrefix)) {
    paths.push(normalized.slice(rootPrefix.length))
  }

  return Array.from(new Set(paths.filter(Boolean)))
}

function normalizePath(path: string) {
  return path.replace(/\/+/gu, '/').replace(/\/$/u, '')
}

function stripLeadingSlash(path: string) {
  return path.startsWith('/') ? path.slice(1) : path
}
