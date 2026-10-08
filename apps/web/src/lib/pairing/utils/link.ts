import { PAIRING_LINK_PATH } from '@workspace/contracts'

/**
 * The code a pairing link carries, as given, or null when this is not one. The server checks it:
 * this runs on every boot, before the pairing code's rules have loaded.
 */
export function pairingCodeFromLink(pathname: string, hash: string) {
  if (!pathname.endsWith(`/${PAIRING_LINK_PATH}`)) return null
  return new URLSearchParams(hash.replace(/^#/, '')).get('token')?.trim().toUpperCase() || null
}
