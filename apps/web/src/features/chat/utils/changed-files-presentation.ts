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

/** Scaled units, largest first, so the first match is the right magnitude. */
const COMPACT_DIFF_UNITS = [
  { suffix: 'b', threshold: 1_000_000_000 },
  { suffix: 'm', threshold: 1_000_000 },
  { suffix: 'k', threshold: 1_000 },
] as const

export type ChangedFilesScopeSummary = {
  fileCount: number
  label: string
}

/**
 * Diff counts share a row with the file name, so a five-digit count pushes the
 * name off the edge. Two significant digits is all a reader takes from it — the
 * exact number stays in the accessible name.
 */
export function formatCompactDiffCount(value: number): string {
  if (!Number.isFinite(value)) return '0'

  const rounded = Math.max(0, Math.round(value))
  for (const unit of COMPACT_DIFF_UNITS) {
    if (rounded < unit.threshold) continue

    return `${formatScaledCount(rounded / unit.threshold)}${unit.suffix}`
  }

  return String(rounded)
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

function formatScaledCount(scaled: number): string {
  if (scaled >= 10) return String(Math.round(scaled))

  return String(Number(scaled.toFixed(1)))
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

function pathSegments(pathValue: string): string[] {
  return pathValue
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0)
}
