import { fileIconRule, fileIconSymbolHref, type ResolvedFileIcon } from '@/lib/file-icons'
import { VSCODE_ICON_GLYPHS } from '@/lib/vscode-icon-glyphs'
import { cn } from '@workspace/ui/lib/utils'
import { useId } from 'react'

/**
 * A file's glyph in its hue. `sprite` draws it through the document's `FileIconSprite`, one
 * `<use>` per icon, for lists that mount thousands of rows.
 */
export function FileTypeIcon({
  icon,
  className,
  sprite = false,
}: {
  icon: ResolvedFileIcon
  className?: string
  sprite?: boolean
}) {
  const id = useId()
  const rule = fileIconRule(icon)
  const glyph = VSCODE_ICON_GLYPHS[rule.glyph]
  if (sprite)
    return (
      <svg
        aria-hidden='true'
        className={cn(rule.className, className)}
        data-file-icon={rule.glyph}
        focusable='false'
        viewBox={glyph.viewBox}
      >
        <use href={fileIconSymbolHref(rule.glyph)} />
      </svg>
    )

  return (
    <svg
      aria-hidden='true'
      className={cn(rule.className, className)}
      data-file-icon={rule.glyph}
      focusable='false'
      viewBox={glyph.viewBox}
      // Bundled paths only. Scope gradient IDs so repeated icons cannot reference a hidden copy.
      dangerouslySetInnerHTML={{ __html: glyph.paths.replaceAll('app-vscode-icon-', `${id}-`) }}
    />
  )
}
