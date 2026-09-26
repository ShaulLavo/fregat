import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { TestContext } from 'vitest'

/** The t3code commit Plan 126's alignment evidence is pinned to. */
const T3CODE_PIN = '7445aa733ada33e45289e5aa5055f79142556513'
const REFERENCE = path.resolve(import.meta.dirname, '../../../../references/t3code')
const SETUP = `git clone https://github.com/pingdotgg/t3code references/t3code && git -C references/t3code checkout ${T3CODE_PIN}`

/**
 * Alignment tests compare against the pinned t3code checkout, which exists only on a developer
 * machine (CI does not fetch it). Without it the test is skipped and says how to get it.
 */
export function requireT3codeReference(skip: TestContext['skip']) {
  if (!existsSync(REFERENCE)) skip(`references/t3code is absent; from the repo root run: ${SETUP}`)
}

/** A file at the pinned commit, read from the local reference checkout. */
export function pinnedT3codeSource(file: string) {
  return execFileSync('git', ['-C', REFERENCE, 'show', `${T3CODE_PIN}:${file}`], {
    encoding: 'utf8',
  })
}
