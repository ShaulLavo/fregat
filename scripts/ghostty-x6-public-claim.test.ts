import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { claimX6Window, verifyX6WindowClaim } from './ghostty-x6-public-claim.ts'

function fixture(run: (registration: string, original: string, replacement: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'x6-claim-'))
  try {
    const registration = join(directory, 'registration.json')
    writeFileSync(registration, '{"frozen":"unit"}')
    const original = join(directory, 'original')
    mkdirSync(original)
    writeFileSync(join(original, 'unit.json'), readFileSync(registration))
    run(registration, original, join(directory, 'replacement'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function overlap(directory: string, valid: boolean): string {
  const file = join(directory, 'overlap.json')
  writeFileSync(file, JSON.stringify({ valid, comparisons: [{ invalid: !valid }] }))
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

test('claims one initial whole window and rejects another identity or direct unclaimed drive', () => {
  fixture((registration, original, replacement) => {
    expect(() => verifyX6WindowClaim(registration, original)).toThrow()
    claimX6Window(registration, original)
    expect(() => verifyX6WindowClaim(registration, original)).not.toThrow()
    expect(() => verifyX6WindowClaim(registration, replacement)).toThrow()
    expect(() => claimX6Window(registration, replacement)).toThrow()
  })
})

test('permits only one separately reviewed qualified-overlap whole-window replacement', () => {
  fixture((registration, original, replacement) => {
    claimX6Window(registration, original)
    const receipt = { windowDirectory: original, overlapSha256: overlap(original, false) }
    claimX6Window(registration, replacement, receipt)
    expect(() => verifyX6WindowClaim(registration, replacement, receipt)).not.toThrow()
    expect(() => claimX6Window(registration, replacement + '-second', receipt)).toThrow()
  })
})

test('a valid performance failure and altered raw identity cannot authorize replacement', () => {
  fixture((registration, original, replacement) => {
    claimX6Window(registration, original)
    const valid = { windowDirectory: original, overlapSha256: overlap(original, true) }
    expect(() => claimX6Window(registration, replacement, valid)).toThrow(
      /valid performance failure/,
    )
    const invalid = { windowDirectory: original, overlapSha256: overlap(original, false) }
    writeFileSync(join(original, 'unit.json'), '{}')
    expect(() => claimX6Window(registration, replacement, invalid)).toThrow(/frozen unit/)
  })
})
