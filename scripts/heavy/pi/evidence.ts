import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createScriptError } from '../../structured-errors'
import { check } from './remote'

// The exit when the command succeeded but its evidence did not arrive (sysexits EX_IOERR).
export const EVIDENCE_FAILED = 74

/** Copies a run directory here and requires its lane.json; fixtures are generated inputs. */
export function collectEvidence(source: string, destination: string) {
  mkdirSync(destination, { recursive: true })
  check(
    ['rsync', '-a', '--exclude=fixture/', '--max-size=50M', `${source}/`, `${destination}/`],
    `Copying evidence from ${source}`,
  )
  if (!existsSync(path.join(destination, 'lane.json'))) {
    throw createScriptError(`The run's lane.json did not arrive in ${destination}.`)
  }
}

export function laneExitCode(commandExit: number, evidenceArrived: boolean) {
  if (commandExit !== 0) return commandExit
  return evidenceArrived ? 0 : EVIDENCE_FAILED
}
