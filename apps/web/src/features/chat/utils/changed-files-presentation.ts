import { pathSegments } from '@/features/chat/utils/path-segments'
import {
  summarizeChatTurnDiffStats,
  type ChatTurnDiffFile,
} from '@/features/chat/utils/turn-diff-tree'

/**
 * A turn that touched a handful of files and a couple of hundred lines is worth
 * reading inline. Past either limit the tree is taller than the message it
 * belongs to, so the card opens collapsed and the reader asks for it.
 */
const CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT = 5
const CHANGED_FILES_AUTO_EXPAND_LINE_LIMIT = 200
const CHANGED_FILES_PREVIEW_FILE_LIMIT = 3
const CHANGED_FILES_PREVIEW_SCOPE_LIMIT = 4

export type ChangedFilesScopeSummary = {
  fileCount: number
  label: string
}

export function changedFileName(pathValue: string): string {
  return pathSegments(pathValue).at(-1) ?? pathValue
}

export function shouldAutoExpandChangedFiles(files: readonly ChatTurnDiffFile[]): boolean {
  if (files.length === 0) return false
  if (files.length > CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT) return false

  const stat = summarizeChatTurnDiffStats(files)
  return stat.additions + stat.deletions <= CHANGED_FILES_AUTO_EXPAND_LINE_LIMIT
}

/**
 * "Where did this turn land" in one line: the top-level directories it touched,
 * busiest first. Ties break on first appearance so the order is stable.
 */
export function summarizeChangedFileScopes(
  files: readonly ChatTurnDiffFile[],
  limit = CHANGED_FILES_PREVIEW_SCOPE_LIMIT,
): ChangedFilesScopeSummary[] {
  const scopes = new Map<string, { fileCount: number; firstIndex: number }>()

  files.forEach((file, index) => {
    const label = changedFileScope(file.path)
    const current = scopes.get(label)
    scopes.set(label, {
      fileCount: (current?.fileCount ?? 0) + 1,
      firstIndex: current?.firstIndex ?? index,
    })
  })

  return Array.from(scopes, ([label, scope]) => ({ label, ...scope }))
    .toSorted(compareScopes)
    .slice(0, limit)
    .map(({ fileCount, label }) => ({ fileCount, label }))
}

/**
 * The few files worth naming while collapsed. One per scope first, so the
 * preview spans the change instead of listing three siblings in one folder.
 */
export function selectChangedFilePreview(
  files: readonly ChatTurnDiffFile[],
  limit = CHANGED_FILES_PREVIEW_FILE_LIMIT,
): ChatTurnDiffFile[] {
  const selected: ChatTurnDiffFile[] = []
  const selectedPaths = new Set<string>()
  const selectedScopes = new Set<string>()

  for (const file of files) {
    const scope = changedFileScope(file.path)
    if (selectedScopes.has(scope)) continue
    if (selected.length === limit) break

    selected.push(file)
    selectedPaths.add(file.path)
    selectedScopes.add(scope)
  }

  for (const file of files) {
    if (selected.length === limit) break
    if (selectedPaths.has(file.path)) continue

    selected.push(file)
  }

  return selected
}

function compareScopes(
  left: ChangedFilesScopeSummary & { firstIndex: number },
  right: ChangedFilesScopeSummary & { firstIndex: number },
) {
  return (
    right.fileCount - left.fileCount ||
    left.firstIndex - right.firstIndex ||
    left.label.localeCompare(right.label)
  )
}

function changedFileScope(pathValue: string): string {
  const segments = pathSegments(pathValue)
  if (segments.length > 1) return segments[0] ?? 'root'

  return 'root'
}
