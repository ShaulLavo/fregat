import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from '@workspace/contracts'

const LINK_PATH = 'pair'

/** The link a device opens to pair: the code rides in the fragment, which no server ever sees. */
export function pairingLink(appBase: string, code: string) {
  return `${new URL(LINK_PATH, appBase).href}#token=${code}`
}

/** The code a pairing link carries, or null when this is not one. */
export function pairingCodeFromLink(pathname: string, hash: string) {
  if (!pathname.endsWith(`/${LINK_PATH}`)) return null
  const code = new URLSearchParams(hash.replace(/^#/, '')).get('token')
  return code ? normalizePairingCode(code) : null
}

/** What a person typed, cleaned up: case, spaces and dashes do not matter. */
export function normalizePairingCode(input: string) {
  const code = input.toUpperCase().replace(/[\s-]/g, '')
  const valid = new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`)
  return valid.test(code) ? code : null
}
