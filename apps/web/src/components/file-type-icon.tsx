import { fileIconRule, type ResolvedFileIcon } from '@/lib/file-icons'
import { FileTypeIcon as WorkbenchFileTypeIcon } from '@shaulavo/workbench-icons/react'

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
  return (
    <WorkbenchFileTypeIcon
      className={className}
      icon={{ name: icon.name, rule: fileIconRule(icon) }}
      preset='rich'
      sprite={sprite}
    />
  )
}
