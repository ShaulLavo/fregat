import { GlobeIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { FileTypeIcon } from '@/components/file-type-icon'

import { faviconUrlForHost } from '@/features/chat/utils/markdown-external-links'

const GLYPH_CLASS_NAME = 'mr-1 inline-block size-3.5 shrink-0 rounded-md align-[-0.15em]'

/**
 * The site's own mark, so a link reads as "GitHub" before it reads as text.
 * Tracks the host the load failed for rather than a boolean, so moving to a
 * different host retries instead of inheriting the previous failure.
 */
export function MarkdownLinkFavicon({ host }: { host: string }) {
  const [failedHost, setFailedHost] = useState<string | null>(null)
  if (host === window.location.hostname) {
    return <FileTypeIcon className={GLYPH_CLASS_NAME} icon={{ name: 'code' }} />
  }
  if (failedHost === host) {
    return <GlobeIcon aria-hidden='true' className={GLYPH_CLASS_NAME} />
  }

  return (
    <img
      alt=''
      aria-hidden='true'
      className={GLYPH_CLASS_NAME}
      data-chat-link-favicon={host}
      draggable={false}
      loading='lazy'
      src={faviconUrlForHost(host)}
      onError={() => setFailedHost(host)}
    />
  )
}
