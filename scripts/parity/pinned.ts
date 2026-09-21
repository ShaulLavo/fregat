import { strictEqual } from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

import inventory from '../../plans/126-t3code-alignment/inventory.json'

/**
 * The upstream commit every parity check reads. Asserted on import, so updating the reference
 * checkout without updating the inventory fails the check instead of comparing against drift.
 */
export const pin = '7445aa733ada33e45289e5aa5055f79142556513'
strictEqual(pin, inventory.upstream_commit)

export function readPinned(path: string) {
  return execFileSync('git', ['-C', 'references/t3code', 'show', `${pin}:${path}`], {
    encoding: 'utf8',
  })
}
