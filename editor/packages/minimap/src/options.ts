import type { EditorMinimapOptions, ResolvedMinimapOptions } from './types'

const DEFAULT_MARK_SECTION_HEADER_REGEX = '\\bMARK:\\s*(?<separator>-?)\\s*(?<label>.*)$'

const DEFAULT_MINIMAP_OPTIONS: ResolvedMinimapOptions = {
  enabled: true,
  autohide: 'none',
  side: 'right',
  size: 'proportional',
  showSlider: 'mouseover',
  renderCharacters: true,
  maxColumn: 120,
  scale: 1,
  showRegionSectionHeaders: true,
  showMarkSectionHeaders: true,
  markSectionHeaderRegex: DEFAULT_MARK_SECTION_HEADER_REGEX,
  sectionHeaderFontSize: 9,
  sectionHeaderLetterSpacing: 1,
}

export function resolveMinimapOptions(options: EditorMinimapOptions = {}): ResolvedMinimapOptions {
  return {
    enabled:
      typeof options.enabled === 'boolean' ? options.enabled : DEFAULT_MINIMAP_OPTIONS.enabled,
    autohide: stringSet(options.autohide, DEFAULT_MINIMAP_OPTIONS.autohide, [
      'none',
      'mouseover',
      'scroll',
    ]),
    side: stringSet(options.side, DEFAULT_MINIMAP_OPTIONS.side, ['left', 'right']),
    size: stringSet(options.size, DEFAULT_MINIMAP_OPTIONS.size, ['proportional', 'fill', 'fit']),
    showSlider: stringSet(options.showSlider, DEFAULT_MINIMAP_OPTIONS.showSlider, [
      'always',
      'mouseover',
    ]),
    renderCharacters:
      typeof options.renderCharacters === 'boolean'
        ? options.renderCharacters
        : DEFAULT_MINIMAP_OPTIONS.renderCharacters,
    maxColumn: clampedInteger(options.maxColumn, DEFAULT_MINIMAP_OPTIONS.maxColumn, 1, 10000),
    scale: clampedInteger(options.scale, DEFAULT_MINIMAP_OPTIONS.scale, 1, 3),
    showRegionSectionHeaders:
      typeof options.showRegionSectionHeaders === 'boolean'
        ? options.showRegionSectionHeaders
        : DEFAULT_MINIMAP_OPTIONS.showRegionSectionHeaders,
    showMarkSectionHeaders:
      typeof options.showMarkSectionHeaders === 'boolean'
        ? options.showMarkSectionHeaders
        : DEFAULT_MINIMAP_OPTIONS.showMarkSectionHeaders,
    markSectionHeaderRegex: validRegexSource(
      options.markSectionHeaderRegex,
      DEFAULT_MINIMAP_OPTIONS.markSectionHeaderRegex,
    ),
    sectionHeaderFontSize: clampedFloat(
      options.sectionHeaderFontSize,
      DEFAULT_MINIMAP_OPTIONS.sectionHeaderFontSize,
      4,
      32,
    ),
    sectionHeaderLetterSpacing: clampedFloat(
      options.sectionHeaderLetterSpacing,
      DEFAULT_MINIMAP_OPTIONS.sectionHeaderLetterSpacing,
      0,
      5,
    ),
  }
}

function stringSet<T extends string>(value: unknown, fallback: T, values: readonly T[]): T {
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : fallback
}

function clampedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function clampedFloat(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function validRegexSource(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback

  try {
    new RegExp(value, 'd')
    return value
  } catch {
    return fallback
  }
}
