import type { PlatformName } from '@workspace/client-core/commands/chord'
import { matchingSettingIds } from '@workspace/client-core/settings/search'
import { descriptorFor, settingParentId, type SettingId } from '@workspace/contracts'

import { isSettingAvailable } from '@/features/settings/utils/availability'
import { MCP_CATEGORY, matchesMcpSearch } from '@/features/settings/utils/mcp'
import { matchesPushSearch } from '@/features/settings/utils/push-device'
import { matchingShortcutRows, type ShortcutRow } from '@/features/settings/utils/shortcut-rows'
import { matchesUsageSearch } from '@/features/settings/utils/usage'
import { getPlatformBridge } from '@/lib/platform/bridge'
import { documentBackdrop } from '@/lib/platform/backdrop'
import { runtimeCapabilities } from '@/lib/platform/capabilities'

export type FormCategories = readonly (readonly [string, SettingId[]])[]

const SHORTCUTS_CATEGORY = 'Keyboard shortcuts'

/**
 * The form's categories for a query and an optional pinned category, each with its row ids.
 * `visible` counts every matching setting, including the push switch the push section draws.
 */
export function formCategories(
  query: string,
  selectedCategory: string | null,
  shortcuts: { readonly rows: readonly ShortcutRow[]; readonly platform: PlatformName },
) {
  // `matchingSettingIds` already searches rows rather than keys, so a key edited
  // from another row is folded into its owner here rather than dropped.
  const bridge = getPlatformBridge()
  const environment = {
    backdrop: documentBackdrop(),
    platform: bridge?.platform,
    windowAppearance: typeof bridge?.setWindowAppearance === 'function',
    nativeTransparency: runtimeCapabilities().nativeTransparency,
  }
  // Settings search finds shortcuts too: a command that matches brings its list along.
  const shortcutsMatch =
    query.trim() !== '' &&
    matchingShortcutRows(shortcuts.rows, query, shortcuts.platform).length > 0
  const matched = matchingSettingIds(query)
  if (shortcutsMatch && !matched.includes('keybindings.overrides'))
    matched.push('keybindings.overrides')
  const visible = matched.filter(
    (id) =>
      (descriptorFor(id).visibility ?? 'user') !== 'internal' &&
      isSettingAvailable(id, environment),
  )
  // The push switch renders inside the push section, beside the devices it sends to.
  const categories = groupByCategory(visible.filter((id) => id !== 'chat.pushNotifications'))
  if (matchesUsageSearch(query)) categories.set('Usage', [])
  if (matchesMcpSearch(query)) categories.set(MCP_CATEGORY, [])
  moveCategoryLast(categories, SHORTCUTS_CATEGORY)
  const showPush =
    matchesPushSearch(query) ||
    visible.includes('chat.notificationMode') ||
    visible.includes('chat.pushNotifications')
  if (showPush && !categories.has('Chat')) categories.set('Chat', [])
  // An address can narrow the page to one category. Unknown or absent means all of
  // them, so a stale link degrades to the full page rather than to nothing.
  const shown: FormCategories = selectedCategory
    ? [...categories].filter(([category]) => category === selectedCategory)
    : [...categories]

  return { shown, showPush, visible }
}

/** What a list costs to mount, counted in rows; a section without rows counts as one. */
export function mountCost(shown: FormCategories): number {
  return shown.reduce((total, [, ids]) => total + Math.max(ids.length, 1), 0)
}

/**
 * Categories in page order until `budget` rows are spent, each with the rows it mounts. `ids`
 * stays the category's own array, so a category whose `limit` did not move keeps its props.
 */
export function mountedCategories(shown: FormCategories, budget: number) {
  const mounted: { category: string; ids: SettingId[]; limit: number }[] = []
  let left = budget
  for (const [category, ids] of shown) {
    if (left <= 0) break

    mounted.push({ category, ids, limit: Math.min(ids.length, left) })
    left -= Math.max(ids.length, 1)
  }

  return mounted
}

/** The shortcut list is hundreds of rows; anything after it would be out of reach. */
function moveCategoryLast(categories: Map<string, SettingId[]>, category: string) {
  const ids = categories.get(category)
  if (!ids) return

  categories.delete(category)
  categories.set(category, ids)
}

/**
 * Grouped by the descriptor's own `category`, not by key prefix. Deriving groups
 * from prefixes invents categories nobody chose and reshuffles the page whenever
 * a key is renamed.
 */
function groupByCategory(ids: readonly SettingId[]): Map<string, SettingId[]> {
  const categories = new Map<string, SettingId[]>()

  for (const id of ids) {
    const category = descriptorFor(id).category
    const existing = categories.get(category)
    if (existing) {
      existing.push(id)
      continue
    }

    categories.set(category, [id])
  }

  for (const [category, members] of categories) {
    categories.set(category, withChildrenUnderParents(members))
  }

  return categories
}

/** A `dependsOn` row follows its parent's row, so its indent reads as belonging to it. */
function withChildrenUnderParents(ids: readonly SettingId[]): SettingId[] {
  const present = new Set(ids)
  const childrenOf = new Map<SettingId, SettingId[]>()
  for (const id of ids) {
    const parent = settingParentId(id)
    if (parent === undefined || !present.has(parent)) continue

    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id])
  }

  return ids.flatMap((id) => {
    const parent = settingParentId(id)
    if (parent !== undefined && present.has(parent)) return []

    return [id, ...(childrenOf.get(id) ?? [])]
  })
}

/** True when this row's parent is shown above it in the same section. */
export function isUnderParent(ids: readonly SettingId[], index: number): boolean {
  const parent = settingParentId(ids[index]!)
  if (parent === undefined) return false

  return ids.slice(0, index).includes(parent)
}
