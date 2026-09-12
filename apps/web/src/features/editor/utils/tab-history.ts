import { rekeyTabFile, sameTabContent, tabContentKey } from '@/lib/documents/utils/tabs'
import type { FilesystemPath, TabContent } from '@/lib/documents/utils/types'

const MAX_EDITOR_HISTORY = 50

export function editorHistoryForSelection(
  contents: readonly TabContent[],
  selected: TabContent | null,
) {
  if (selected === null) return contents
  return uniqueRecentContents([selected, ...contents])
}

export function editorHistoryForClosedContent(contents: readonly TabContent[], closed: TabContent) {
  return contents.filter((content) => !sameTabContent(content, closed))
}

export function editorHistoryForRenamedFile(
  contents: readonly TabContent[],
  from: FilesystemPath,
  to: FilesystemPath,
) {
  return uniqueRecentContents(contents.map((content) => rekeyTabFile(content, from, to)))
}

export function recentlyClosedTabsForClose(contents: readonly TabContent[], closed: TabContent) {
  return uniqueRecentContents([closed, ...contents])
}

export function recentlyClosedTabsForReopen(contents: readonly TabContent[], reopened: TabContent) {
  return contents.filter((content) => !sameTabContent(content, reopened))
}

export function previousOpenTabContent(
  history: readonly TabContent[],
  openContents: readonly TabContent[],
  selected: TabContent | null,
) {
  const openKeys = new Set(openContents.map(tabContentKey))
  for (const content of history) {
    if (selected !== null && sameTabContent(content, selected)) continue
    if (!openKeys.has(tabContentKey(content))) continue
    return content
  }
  return null
}

function uniqueRecentContents(contents: readonly TabContent[]) {
  const unique = new Map<string, TabContent>()
  for (const content of contents) {
    const key = tabContentKey(content)
    if (unique.has(key)) continue
    unique.set(key, content)
    if (unique.size === MAX_EDITOR_HISTORY) break
  }
  return Array.from(unique.values())
}
