import { fileIconSpriteSymbols } from '@/lib/file-icons'

/** Every file glyph as a `<symbol>`, mounted once, for icons drawn with `FileTypeIcon`'s `sprite`. */
export function FileIconSprite() {
  return (
    <svg
      aria-hidden='true'
      className='pointer-events-none absolute size-0 overflow-hidden'
      data-file-icon-sprite=''
      focusable='false'
      // Bundled glyphs only. Hidden with size, not `display: none`, which drops its gradients.
      dangerouslySetInnerHTML={{ __html: fileIconSpriteSymbols() }}
    />
  )
}
