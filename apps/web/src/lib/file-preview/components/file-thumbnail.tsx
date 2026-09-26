import { cn } from '@workspace/ui/lib/utils'
import { useState, type ReactNode } from 'react'

type Load = { readonly src: string; readonly state: 'loading' | 'shown' | 'instant' | 'failed' }

/**
 * An image that fades in on its first load only. A remount for an image the browser already
 * holds attaches to a complete `<img>`, so it shows at once with no module-level memory of URLs.
 * A failed load shows the caller's fallback, usually the entry's icon.
 */
export function FileThumbnail({
  className,
  fallback,
  src,
}: {
  className?: string
  fallback: ReactNode
  src: string
}) {
  const [load, setLoad] = useState<Load>({ src, state: 'loading' })
  const state = load.src === src ? load.state : 'loading'

  if (state === 'failed') return fallback

  return (
    <img
      alt=''
      className={cn(
        'h-40 w-full rounded-md object-contain',
        state === 'loading' && 'opacity-0',
        state === 'shown' &&
          'duration-(--duration-enter) ease-(--ease-out-strong) transition-opacity',
        className,
      )}
      // CORS mode sends the page's Origin, which is how /fs/blob authorizes an image request.
      crossOrigin='anonymous'
      decoding='async'
      ref={(image) => {
        if (image?.complete && image.naturalWidth > 0 && state === 'loading')
          setLoad({ src, state: 'instant' })
      }}
      src={src}
      onError={() => setLoad({ src, state: 'failed' })}
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth === 0) return setLoad({ src, state: 'failed' })
        setLoad((current) =>
          current.src === src && current.state === 'instant' ? current : { src, state: 'shown' },
        )
      }}
    />
  )
}
