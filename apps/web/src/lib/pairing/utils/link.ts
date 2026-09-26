const LINK_PATH = 'pair'

/** The link a device opens to pair: the code rides in the fragment, which no server ever sees. */
export function pairingLink(appBase: string, code: string) {
  return `${new URL(LINK_PATH, appBase).href}#token=${code}`
}

/**
 * The code a pairing link carries, as given, or null when this is not one. The server checks it:
 * this runs on every boot, before the pairing code's rules have loaded.
 */
export function pairingCodeFromLink(pathname: string, hash: string) {
  if (!pathname.endsWith(`/${LINK_PATH}`)) return null
  return new URLSearchParams(hash.replace(/^#/, '')).get('token')?.trim().toUpperCase() || null
}
