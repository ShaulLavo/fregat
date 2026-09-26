import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from '@workspace/contracts'

const VALID = new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`)

/** What a person typed, cleaned up: case, spaces and dashes do not matter. */
export function normalizePairingCode(input: string) {
  const code = input.toUpperCase().replace(/[\s-]/g, '')
  return VALID.test(code) ? code : null
}
