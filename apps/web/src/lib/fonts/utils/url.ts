import { activeServerOrigin } from '@/lib/client'

/** A font route on the server this page talks to. */
export function fontServerUrl(path: string): URL {
  const origin = activeServerOrigin()
  return new URL(path, origin.endsWith('/') ? origin : `${origin}/`)
}
