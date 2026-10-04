import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

export interface ReplacementClaim {
  readonly windowDirectory: string
  readonly overlapSha256: string
}
interface Claim {
  readonly registrationSha256: string
  readonly windowDirectory: string
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

export function claimX6Window(
  registrationFile: string,
  windowDirectory: string,
  replacement?: ReplacementClaim,
): void {
  const registrationSha256 = hash(readFileSync(registrationFile))
  const directory = dirname(registrationFile)
  const claim: Claim = { registrationSha256, windowDirectory: resolve(windowDirectory) }
  if (!replacement) {
    writeFileSync(join(directory, 'initial-window-claim.json'), JSON.stringify(claim, null, 2), {
      flag: 'wx',
    })
    return
  }
  const initial = JSON.parse(
    readFileSync(join(directory, 'initial-window-claim.json'), 'utf8'),
  ) as Claim
  assert.equal(initial.registrationSha256, registrationSha256)
  assert.equal(initial.windowDirectory, resolve(replacement.windowDirectory))
  const originalUnit = readFileSync(join(initial.windowDirectory, 'unit.json'))
  assert.equal(hash(originalUnit), registrationSha256, 'Same frozen unit required')
  const overlapBytes = readFileSync(join(initial.windowDirectory, 'overlap.json'))
  assert.equal(hash(overlapBytes), replacement.overlapSha256)
  const overlap = JSON.parse(overlapBytes.toString()) as {
    valid: boolean
    comparisons: readonly { invalid: boolean }[]
  }
  assert.equal(overlap.valid, false, 'A valid performance failure never authorizes replacement')
  assert(
    overlap.comparisons.some((comparison) => comparison.invalid),
    'Qualified one-sided exposure required',
  )
  writeFileSync(join(directory, 'replacement-window-claim.json'), JSON.stringify(claim, null, 2), {
    flag: 'wx',
  })
}

export function verifyX6WindowClaim(
  registrationFile: string,
  windowDirectory: string,
  replacement?: ReplacementClaim,
): void {
  const file = join(
    dirname(registrationFile),
    replacement ? 'replacement-window-claim.json' : 'initial-window-claim.json',
  )
  const claim = JSON.parse(readFileSync(file, 'utf8')) as Claim
  assert.equal(claim.registrationSha256, hash(readFileSync(registrationFile)))
  assert.equal(
    claim.windowDirectory,
    resolve(windowDirectory),
    'Claim belongs to this single whole window',
  )
}
