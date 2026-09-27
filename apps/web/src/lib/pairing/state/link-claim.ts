import { pairingCodeFromLink } from '@/lib/pairing/utils/link'

/**
 * Takes the code out of a pairing link and puts the app's own address in its place, before
 * anything reads the location: the code must not stay in history, and `pair` is not a place.
 */
export function takePairingCodeFromLocation(appBase: string) {
  const code = pairingCodeFromLink(window.location.pathname, window.location.hash)
  if (code === null) return null
  window.history.replaceState(null, '', appBase)
  return code
}
