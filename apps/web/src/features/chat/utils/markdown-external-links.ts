/**
 * A link out of the transcript is the one thing in a message the app cannot
 * verify, so its host is surfaced rather than hidden behind the anchor text.
 */

export function externalLinkHost(href: string | undefined) {
  if (!href) return null

  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

    return url.hostname || null
  } catch {
    return null
  }
}

export function faviconUrlForHost(host: string) {
  // The s2 redirect lacks CORP; the image endpoint permits cross-origin embedding.
  return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${host}`)}&size=32`
}
