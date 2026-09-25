import {
  BUNDLED_FONTS,
  CURATED_FONTS,
  fuzzyRank,
  parseFontRef,
  type BundledFontId,
  type FontCatalogEntry,
  type FontRef,
  type FontRole,
} from '@workspace/contracts'

import type { FontSettingId } from '@/features/settings/providers/font-preview-context'

export type FontOption = {
  readonly ref: string
  readonly label: string
  /** Where it comes from, shown on the row: two sources can share a family name. */
  readonly source: string
  /** Source and category, for the row's title. */
  readonly detail: string
}

export type FontOptionGroup = { readonly value: string; readonly items: readonly FontOption[] }

const SEARCH_LIMIT = 30

export function isFontSettingId(id: string): id is FontSettingId {
  return id === 'workbench.fontFamily' || id === 'editor.fontFamily'
}

const SAMPLE_TEXT: Readonly<Record<FontRole, string>> = {
  ui: 'The quick brown fox 0123',
  code: 'AaBbGg 0123 => !==',
}

export function fontSampleText(role: FontRole): string {
  return SAMPLE_TEXT[role]
}

/** Shipped in the bundle, so a search finds them next to the downloadable families. */
const BUNDLED_ENTRIES: readonly FontCatalogEntry[] = [
  bundledEntry('inter', 'sans-serif'),
  bundledEntry('jetbrains-mono', 'monospace'),
]

/** What the picker shows before anything is typed: recent choices above the curated list. */
function suggestedFontGroups(
  role: FontRole,
  recent: readonly string[],
  catalog: readonly FontCatalogEntry[] | undefined,
): FontOptionGroup[] {
  const curated = CURATED_FONTS[role]
  const recentRefs = recent.filter((ref) => !curated.some((font) => font.ref === ref))
  const groups: FontOptionGroup[] = []
  if (recentRefs.length > 0) {
    groups.push({ value: 'Recent', items: recentRefs.map((ref) => fontOption(ref, catalog)) })
  }
  groups.push({ value: 'Suggested', items: curated.map((font) => fontOption(font.ref, catalog)) })
  return groups
}

/**
 * The whole catalog ranked against `query`. The family is the label, and category, source and
 * id are keywords, so "mono" or "serif" narrows the list. The code role ranks monospace first
 * but hides nothing; an exact family outranks both. No match offers the installed font.
 */
export function searchFontOptions(
  query: string,
  role: FontRole,
  catalog: readonly FontCatalogEntry[],
): FontOption[] {
  const ranked = [...BUNDLED_ENTRIES, ...catalog].flatMap((entry) => rankedEntry(entry, query))
  ranked.sort((left, right) => compareRanked(left, right, role))
  const results = ranked.slice(0, SEARCH_LIMIT).map(({ entry }) => entryOption(entry))
  if (results.length > 0) return results

  const installed = installedFontOption(query)
  return installed ? [installed] : []
}

function installedFontOption(query: string): FontOption | null {
  const ref = `local:${query.trim()}`
  if (!parseFontRef(ref)) return null

  return {
    ref,
    label: `Use installed font '${query.trim()}'`,
    source: SOURCE_LABELS.local,
    detail: SOURCE_LABELS.local,
  }
}

/** A label for any ref, from the curated list, the catalog, or the id itself. */
export function fontOption(
  ref: string,
  catalog: readonly FontCatalogEntry[] | undefined,
): FontOption {
  const entry = catalog?.find((candidate) => candidate.ref === ref)
  if (entry) return entryOption(entry)

  const parsed = parseFontRef(ref)
  if (!parsed) return { ref, label: ref, source: 'unknown', detail: 'unknown' }

  const source = SOURCE_LABELS[parsed.source]
  return { ref, label: refLabel(parsed), source, detail: source }
}

function refLabel(ref: FontRef) {
  if (ref.source === 'bundled') return BUNDLED_FONTS[ref.id as BundledFontId].label

  const curated = [...CURATED_FONTS.ui, ...CURATED_FONTS.code].find(
    (font) => font.ref === `${ref.source}:${ref.id}`,
  )
  return curated?.label ?? ref.id
}

type RankedEntry = {
  readonly entry: FontCatalogEntry
  readonly exact: boolean
  readonly score: number
}

function rankedEntry(entry: FontCatalogEntry, query: string): RankedEntry[] {
  const id = entry.ref.slice(entry.ref.indexOf(':') + 1)
  const rank = fuzzyRank(
    { label: entry.family, keywords: [entry.category, entry.source, id] },
    query,
  )
  if (!rank) return []

  const exact = entry.family.toLowerCase() === query.trim().toLowerCase()
  return [{ entry, exact, score: rank.score }]
}

function compareRanked(left: RankedEntry, right: RankedEntry, role: FontRole) {
  if (left.exact !== right.exact) return left.exact ? -1 : 1
  if (role === 'code') {
    const leftMono = left.entry.category === 'monospace'
    const rightMono = right.entry.category === 'monospace'
    if (leftMono !== rightMono) return leftMono ? -1 : 1
  }
  return (
    right.score - left.score ||
    left.entry.family.length - right.entry.family.length ||
    left.entry.family.localeCompare(right.entry.family)
  )
}

function entryOption(entry: FontCatalogEntry): FontOption {
  return {
    ref: entry.ref,
    label: entry.family,
    source: SOURCE_LABELS[entry.source],
    detail: `${SOURCE_LABELS[entry.source]} · ${entry.category}`,
  }
}

const SOURCE_LABELS: Readonly<Record<FontCatalogEntry['source'], string>> = {
  bundled: 'bundled',
  nerd: 'Nerd Font',
  fontsource: 'Fontsource',
  local: 'installed',
}

function bundledEntry(id: keyof typeof BUNDLED_FONTS, category: string): FontCatalogEntry {
  return {
    ref: `bundled:${id}`,
    family: BUNDLED_FONTS[id].label,
    source: 'bundled',
    category,
    variable: true,
    weights: [400, 500, 600, 700],
    license: 'OFL-1.1',
  }
}

/** The picker's rows for a query: suggestions when empty, ranked search results otherwise. */
export function fontPickerGroups(
  query: string,
  role: FontRole,
  recent: readonly string[],
  catalog: readonly FontCatalogEntry[] | undefined,
): FontOptionGroup[] {
  if (query.trim() === '') return suggestedFontGroups(role, recent, catalog)

  return [{ value: '', items: searchFontOptions(query, role, catalog ?? []) }]
}
