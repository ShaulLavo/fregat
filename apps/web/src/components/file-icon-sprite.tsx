import { FileIconSprite as WorkbenchFileIconSprite } from '@shaulavo/workbench-icons/react'

/** Every file glyph as a `<symbol>`, mounted once, for icons drawn with `FileTypeIcon`'s `sprite`. */
export function FileIconSprite() {
  return <WorkbenchFileIconSprite preset='rich' />
}
