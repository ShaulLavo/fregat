import {
  buildFileIconSpriteMarkup,
  getFileIconRule,
  resolveFileIcon,
  type FileIconEntry,
  type FileIconRule,
  type FileIconRuleName,
} from '@shaulavo/workbench-icons'

export type { FileIconEntry, FileIconRule }

export type ResolvedFileIcon = {
  readonly name: FileIconRuleName
}

export function iconForEntry(
  entry: FileIconEntry,
  options: { open?: boolean } = {},
): ResolvedFileIcon {
  return resolveFileIcon(entry, options)
}

/** The glyph and hue metadata a resolved icon draws with. */
export function fileIconRule(icon: ResolvedFileIcon): FileIconRule {
  return getFileIconRule(icon.name)
}

/** Every glyph as a `<symbol>`, for the one sprite the document mounts. */
export function fileIconSpriteSymbols() {
  return buildFileIconSpriteMarkup('rich')
}
