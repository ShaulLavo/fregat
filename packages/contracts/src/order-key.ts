/**
 * Fractional index keys for a user-arranged list.
 *
 * A row carries an optional order key — a base-26 string. The list sorts keyed
 * rows by plain string comparison, so a drag writes ONE key to ONE row: the
 * neighbours are never rewritten, and two clients that saw the same drop
 * converge on the same order without a shared counter.
 *
 * One algorithm serves every arranged list: the pinned session block (which
 * persists its key as `pinOrderKey`) and the project list (`orderKey`).
 */
const ORDER_KEY_DIGITS = 'abcdefghijklmnopqrstuvwxyz'

const ORDER_KEY_MIN_DIGIT = ORDER_KEY_DIGITS.charAt(0)

export function isValidOrderKey(key: string) {
  if (key.length === 0) return false
  for (const char of key) {
    if (!ORDER_KEY_DIGITS.includes(char)) return false
  }

  // A trailing minimum digit would leave no room to sort a key immediately
  // before this one; generators never produce it, so treat it as corrupt.
  return key.at(-1) !== ORDER_KEY_MIN_DIGIT
}

/**
 * Midpoint of two digit strings read as fractions in (0, 1). `''` stands for
 * the open bound on either side. Only reachable through `orderKeyBetween`,
 * which is what establishes `a < b` — the recursion preserves it.
 */
function orderKeyMidpoint(a: string, b: string): string {
  if (b !== '') {
    // Recurse past the longest common prefix (the minimum digit pads the
    // shorter side).
    let n = 0
    while ((a.charAt(n) || ORDER_KEY_MIN_DIGIT) === b.charAt(n)) n += 1
    if (n > 0) return b.slice(0, n) + orderKeyMidpoint(a.slice(n), b.slice(n))
  }

  const digitA = a === '' ? 0 : ORDER_KEY_DIGITS.indexOf(a.charAt(0))
  const digitB = b === '' ? ORDER_KEY_DIGITS.length : ORDER_KEY_DIGITS.indexOf(b.charAt(0))
  if (digitB - digitA > 1) return ORDER_KEY_DIGITS.charAt(Math.round((digitA + digitB) / 2))
  // Consecutive leading digits: either b has spare digits to shorten into, or
  // we extend a — never producing a trailing minimum digit, because the base
  // case midpoint('', '') is the middle of the alphabet.
  if (b.length > 1) return b.charAt(0)

  return ORDER_KEY_DIGITS.charAt(digitA) + orderKeyMidpoint(a.slice(1), '')
}

/**
 * Key that sorts strictly between two neighbours; `null` bounds mean "top of
 * the list" / "bottom of the keyed run". Returns `null` rather than throwing
 * when the existing keys are corrupt or out of order.
 */
export function orderKeyBetween(before: string | null, after: string | null): string | null {
  const a = before ?? ''
  const b = after ?? ''
  if (a !== '' && !isValidOrderKey(a)) return null
  if (b !== '' && !isValidOrderKey(b)) return null
  if (b !== '' && a >= b) return null

  return orderKeyMidpoint(a, b)
}
