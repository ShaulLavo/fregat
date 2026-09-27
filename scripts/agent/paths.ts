import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// macOS exposes /var through /private/var; fixture authorization compares canonical paths.
export const scratchRoot = realpathSync(tmpdir())
export const checkoutRoot = path.resolve(import.meta.dirname, '../..')
export const evidenceRoot = process.env.FREGAT_EVIDENCE_ROOT ?? scratchPath('fregat-evidence')

export function scratchPath(name: string) {
  return path.join(scratchRoot, name)
}
