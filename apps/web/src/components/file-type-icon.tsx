import { fileIconRule, type ResolvedFileIcon } from '@/lib/file-icons'
import { VSCODE_ICON_GLYPHS } from '@/lib/vscode-icon-glyphs'
import { cn } from '@workspace/ui/lib/utils'
import { useId } from 'react'

export function FileTypeIcon({ icon, className }: { icon: ResolvedFileIcon; className?: string }) {
  const id = useId()
  const rule = fileIconRule(icon)
  const glyph = VSCODE_ICON_GLYPHS[rule.glyph]
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
