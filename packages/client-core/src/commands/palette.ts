import { compareValues as compareNumbers } from '@workspace/utils/compare'
import { queryPieces } from '@workspace/contracts'
import { fuzzyRankScore } from '@workspace/contracts'

export type PaletteRankItem = {
  readonly id: string
  readonly category: string
  readonly keywords: readonly string[]
}
export type QuickAccessMode =
  | 'appColors'
  | 'colorMode'
  | 'colorTheme'
  | 'commands'
  | 'editors'
  | 'files'
  | 'gotoLine'
  | 'scripts'
  | 'sessions'
  | 'symbols'
  | 'themeBundle'
  | 'views'
  | 'wallpaper'
const SCRIPT_PREFIX = 'run '
const SESSION_PREFIX = 'sess '

export const RECENTLY_USED_COMMANDS_HEADING = 'Recently Used'
export const OTHER_COMMANDS_HEADING = 'Other Commands'
const ALL_COMMANDS_HEADING = 'Commands'
const RECENTLY_USED_COMMANDS_SHOWN = 6

export function groupedCommandItems<Item extends PaletteRankItem>(
  items: readonly Item[],
  search = '',
  recentCommandIds: readonly string[] = [],
): readonly (readonly [string, readonly Item[]])[] {
  const query = quickAccessQuery(search)
  const recency = recencyRankByCommandId(recentCommandIds)
  if (query) return searchedCommandGroups(rankedCommandItems(items, query), recency)

  return recentCommandsFirstGroups(items, recency)
}

function recencyRankByCommandId(recentCommandIds: readonly string[]): ReadonlyMap<string, number> {
  return new Map(recentCommandIds.map((commandId, rank) => [commandId, rank]))
}

function commandRecencyRank<Item extends PaletteRankItem>(
  item: Item,
  recency: ReadonlyMap<string, number>,
) {
  return recency.get(item.id) ?? Number.MAX_SAFE_INTEGER
}

function recentCommandsFirstGroups<Item extends PaletteRankItem>(
  items: readonly Item[],
  recency: ReadonlyMap<string, number>,
): readonly (readonly [string, readonly Item[]])[] {
  const recent = items
    .filter((item) => recency.has(item.id))
    .toSorted(
      (left, right) => commandRecencyRank(left, recency) - commandRecencyRank(right, recency),
    )
    .slice(0, RECENTLY_USED_COMMANDS_SHOWN)
  if (recent.length === 0) return groupedCommandItemsInOrder(items)

  const promoted = new Set(recent.map((item) => item.id))

  return [
    [RECENTLY_USED_COMMANDS_HEADING, recent] as const,
    ...groupedCommandItemsInOrder(items.filter((item) => !promoted.has(item.id))),
  ]
}

function searchedCommandGroups<Item extends PaletteRankItem>(
  ranked: readonly Item[],
  recency: ReadonlyMap<string, number>,
): readonly (readonly [string, readonly Item[]])[] {
  const recent = ranked
    .filter((item) => recency.has(item.id))
    .toSorted(
      (left, right) => commandRecencyRank(left, recency) - commandRecencyRank(right, recency),
    )
  if (recent.length === 0) return [[ALL_COMMANDS_HEADING, ranked] as const]

  const rest = ranked.filter((item) => !recency.has(item.id))
  if (rest.length === 0) return [[RECENTLY_USED_COMMANDS_HEADING, recent] as const]

  return [
    [RECENTLY_USED_COMMANDS_HEADING, recent] as const,
    [OTHER_COMMANDS_HEADING, rest] as const,
  ]
}

function groupedCommandItemsInOrder<Item extends PaletteRankItem>(
  items: readonly Item[],
): readonly (readonly [string, readonly Item[]])[] {
  const groups = new Map<string, Item[]>()
  for (const item of items) {
    const group = groups.get(item.category)
    if (group) {
      group.push(item)
      continue
    }

    groups.set(item.category, [item])
  }

  return Array.from(groups.entries())
}

type RankedCommandItem<Item extends PaletteRankItem> = {
  readonly item: Item
  readonly order: number
  readonly score: number
  readonly strong: boolean
}

function rankedCommandItems<Item extends PaletteRankItem>(items: readonly Item[], query: string) {
  const ranked = items.flatMap((item, order) => rankedCommandItem(item, query, order))
  const hasStrongMatch = ranked.some((item) => item.strong)

  return ranked
    .filter((item) => !hasStrongMatch || item.strong)
    .toSorted(compareRankedCommandItems)
    .map((item) => item.item)
}

function rankedCommandItem<Item extends PaletteRankItem>(item: Item, query: string, order: number) {
  const score = quickAccessFilter(item.id, query, item.keywords)
  if (score <= 0) return []

  return [{ item, order, score, strong: commandItemStrongMatch(item, query) }]
}

function commandItemStrongMatch<Item extends PaletteRankItem>(item: Item, query: string) {
  const pieces = queryPieces(query)
  if (pieces.length === 0) return true

  return pieces.every((piece) => commandItemMatchesPiece(item, piece))
}

function commandItemMatchesPiece<Item extends PaletteRankItem>(item: Item, piece: string) {
  return item.keywords.some((keyword) => keyword.toLowerCase().includes(piece))
}

// Recency is applied a level up, by splitting these into recent and not, so the only
// job left here is match quality — with registry order settling what the score cannot.
function compareRankedCommandItems<Item extends PaletteRankItem>(
  left: RankedCommandItem<Item>,
  right: RankedCommandItem<Item>,
) {
  return compareNumbers(right.score, left.score) || compareNumbers(left.order, right.order)
}

export function quickAccessMode(search: string): QuickAccessMode {
  if (search.startsWith('colors ')) return 'appColors'
  if (search.startsWith('code ')) return 'colorTheme'
  if (search.startsWith('view ')) return 'views'
  if (search.startsWith('wallpaper ')) return 'wallpaper'
  if (search.startsWith('color ')) return 'colorMode'
  if (search.startsWith('theme ')) return 'themeBundle'
  if (search.startsWith('edt ')) return 'editors'
  if (search.startsWith(SCRIPT_PREFIX)) return 'scripts'
  if (search.startsWith(SESSION_PREFIX)) return 'sessions'
  if (search.startsWith('@')) return 'symbols'
  if (search.startsWith(':')) return 'gotoLine'
  return search.startsWith('>') ? 'commands' : 'files'
}

export function quickAccessQuery(search: string) {
  if (search.startsWith('colors ')) return search.slice(7).trimStart()
  if (search.startsWith('code ')) return search.slice(5).trimStart()
  if (search.startsWith('view ')) return search.slice(5).trimStart()
  if (search.startsWith('color ')) return search.slice(6).trimStart()
  if (search.startsWith('theme ')) return search.slice(6).trimStart()
  if (search.startsWith('edt ')) return search.slice(4).trimStart()
  if (search.startsWith(SCRIPT_PREFIX)) return search.slice(SCRIPT_PREFIX.length).trimStart()
  if (search.startsWith(SESSION_PREFIX)) return search.slice(SESSION_PREFIX.length).trimStart()
  if (search.startsWith('@')) return search.slice(1).trimStart()
  if (search.startsWith(':')) return search.slice(1).trimStart()
  if (!search.startsWith('>')) return search

  return search.slice(1).trimStart()
}

export function quickAccessFilter(value: string, search: string, keywords?: readonly string[]) {
  return scopedPaletteFilter(value, quickAccessQuery(search), keywords)
}

export function scopedPaletteFilter(value: string, search: string, keywords?: readonly string[]) {
  if (!search) return 1

  return fuzzyRankScore(quickAccessRankTarget(value, keywords), search)
}

function quickAccessRankTarget(value: string, keywords: readonly string[] | undefined) {
  const label = keywords?.[0] ?? value
  const path = keywords?.[1] ?? value
  const extraKeywords = [value].concat(keywords?.slice(2) ?? [])

  return { label, keywords: extraKeywords, path }
}
