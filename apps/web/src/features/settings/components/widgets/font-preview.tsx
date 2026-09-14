import { useEffect, useState } from 'react'

import { fontPreviewUrl } from '@/lib/default-nerd-font'

const PREVIEW_TEXT = 'AaBbGg 0123 => !=='

/**
 * One row of the font picker, drawn in the font it names.
 *
 * The server returns a woff2 subsetted to just this text, so previewing seventy
 * fonts costs seventy small files rather than seventy full families. Registered
 * under a `… Preview` family so it can never be mistaken for the real face the
 * editor loads.
 */
export function FontPreview({ fontId }: { fontId: string }) {
  const family = `${fontId} Preview`
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (typeof FontFace === 'undefined' || !document.fonts) return

    let cancelled = false
    const face = new FontFace(family, `url(${fontPreviewUrl(fontId, PREVIEW_TEXT)})`)
    void face
      .load()
      .then((loadedFace) => {
        if (cancelled) return

        document.fonts.add(loadedFace)
        setLoaded(true)
      })
      // A font that will not download is not an error worth showing: the row
      // falls back to the app's own monospace face and stays selectable.
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [family, fontId])

  return (
    <span className='flex min-w-0 flex-col' title={`${family} (${fontId})`}>
      <span className='text-muted-foreground truncate text-xs'>{fontId}</span>
      <span
        className='truncate text-sm'
        style={loaded ? { fontFamily: `"${family}", var(--font-mono)` } : undefined}
      >
        {PREVIEW_TEXT}
      </span>
    </span>
  )
}
