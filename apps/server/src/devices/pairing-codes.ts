import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from '@workspace/contracts'

const CODE_TTL_MS = 5 * 60_000
const FAILURE_WINDOW_MS = 60_000
const FAILURES_PER_WINDOW = 10

export type CodeClaim = 'accepted' | 'invalid' | 'rate-limited'

/**
 * Codes live in memory only: one lasts 5 minutes and works once, so a restart losing them costs a
 * new link. Consuming deletes before anything else runs, which is what makes it single use.
 */
export class PairingCodes {
  private readonly codes = new Map<string, number>()
  private failures: number[] = []

  issue(now: number) {
    this.prune(now)
    const code = randomCode()
    const expiresAt = now + CODE_TTL_MS
    this.codes.set(code, expiresAt)
    return { code, expiresAt: new Date(expiresAt).toISOString() }
  }

  claim(code: string, now: number): CodeClaim {
    this.failures = this.failures.filter((at) => now - at < FAILURE_WINDOW_MS)
    if (this.failures.length >= FAILURES_PER_WINDOW) return 'rate-limited'
    const expiresAt = this.codes.get(code)
    this.codes.delete(code)
    if (expiresAt !== undefined && expiresAt > now) return 'accepted'
    this.failures.push(now)
    return 'invalid'
  }

  private prune(now: number) {
    for (const [code, expiresAt] of this.codes) if (expiresAt <= now) this.codes.delete(code)
  }
}

// 256 is a multiple of 32, so masking a random byte picks every symbol equally often.
function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(PAIRING_CODE_LENGTH))
  return Array.from(bytes, (byte) => PAIRING_CODE_ALPHABET[byte & 31]).join('')
}
