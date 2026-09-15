import { colorForFileIcon, type ResolvedFileIcon } from '@/lib/file-icons'
import { VSCODE_ICON_GLYPHS } from '@/lib/vscode-icon-glyphs'
import { useId } from 'react'

export function FileTypeIcon({ icon, className }: { icon: ResolvedFileIcon; className?: string }) {
  const id = useId()
  const glyph = VSCODE_ICON_GLYPHS[icon.name]
  return (
    <svg
      aria-hidden='true'
      className={className}
      data-file-icon={icon.name}
      focusable='false'
      viewBox={glyph.viewBox}
      style={{ color: colorForFileIcon(icon) }}
      // Bundled paths only. Scope gradient IDs so repeated icons cannot reference a hidden copy.
      dangerouslySetInnerHTML={{ __html: glyph.paths.replaceAll('app-vscode-icon-', `${id}-`) }}
    />
  )
}
