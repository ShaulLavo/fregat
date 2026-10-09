import {
  FILE_ICON_EXTENSIONS,
  FILE_ICON_FILE_NAMES,
  FILE_ICON_RULES,
  type FileIconRuleName,
} from '@/lib/file-icon-rules.generated'
import { VSCODE_ICON_GLYPHS, type FileIconGlyph } from '@/lib/vscode-icon-glyphs'

export type FileIconEntry = {
  name: string
  type: 'file' | 'directory' | 'symlink' | 'other'
}

export type ResolvedFileIcon = {
  readonly name: FileIconRuleName
}

const SYMBOL_PREFIX = 'app-vscode-icon-'
const GLYPH_NAMES = Object.keys(VSCODE_ICON_GLYPHS) as FileIconGlyph[]

export function iconForEntry(
  entry: FileIconEntry,
  options: { open?: boolean } = {},
): ResolvedFileIcon {
  if (entry.type === 'directory') {
    return iconResult(options.open ? 'folder-open-duo' : 'folder-duo')
  }

  if (entry.type === 'symlink') return iconResult('file-symlink-duo')
  if (entry.type !== 'file') return iconResult('file-duo')

  return iconResult(iconNameForFile(entry.name))
}

/** The glyph and the literal hue classes a resolved icon draws with. */
export function fileIconRule(icon: ResolvedFileIcon) {
  return Object.hasOwn(FILE_ICON_RULES, icon.name)
    ? FILE_ICON_RULES[icon.name]
    : FILE_ICON_RULES['file-duo']
}

/** The `<use>` reference for a glyph in the document's `FileIconSprite`. */
export function fileIconSymbolHref(glyph: FileIconGlyph) {
  return `#${SYMBOL_PREFIX}${glyph}`
}

/** Every glyph as a `<symbol>`, for the one sprite the document mounts. */
export function fileIconSpriteSymbols() {
  return GLYPH_NAMES.map((name) => {
    const glyph = VSCODE_ICON_GLYPHS[name]
    return `<symbol id="${SYMBOL_PREFIX}${name}" viewBox="${glyph.viewBox}">${glyph.paths}</symbol>`
  }).join('')
}

function iconNameForFile(name: string): FileIconRuleName {
  const normalizedName = normalizeName(name)
  if (Object.hasOwn(FILE_ICON_FILE_NAMES, normalizedName)) {
    return FILE_ICON_FILE_NAMES[normalizedName]
  }

  for (const extension of extensionCandidates(normalizedName)) {
    if (Object.hasOwn(FILE_ICON_EXTENSIONS, extension)) return FILE_ICON_EXTENSIONS[extension]
  }

  return 'file-duo'
}

// One frozen object per rule, so a row that re-renders passes its icon the same prop.
const RESOLVED_ICONS = new Map<FileIconRuleName, ResolvedFileIcon>()

function iconResult(name: FileIconRuleName): ResolvedFileIcon {
  const cached = RESOLVED_ICONS.get(name)
  if (cached) return cached

  const icon = Object.freeze({ name })
  RESOLVED_ICONS.set(name, icon)
  return icon
}

function extensionCandidates(name: string) {
  const normalizedName = normalizeName(name)
  const dotIndexes = indexesOf(normalizedName, '.')
  return dotIndexes.map((index) => normalizedName.slice(index))
}

function indexesOf(value: string, needle: string) {
  const indexes: number[] = []
  let index = value.indexOf(needle)

  while (index >= 0) {
    indexes.push(index)
    index = value.indexOf(needle, index + needle.length)
  }

  return indexes
}

function normalizeName(name: string) {
  return name.trim().toLocaleLowerCase()
}
