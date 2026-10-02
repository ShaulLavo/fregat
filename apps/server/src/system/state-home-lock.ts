import { readFileSync } from 'node:fs'
import path from 'node:path'
import { tryFileLock } from './file-lock'
import { systemErrors } from './structured-errors'

/** Holds `server.lock` in the state home for this process's lifetime, whatever its port. */
export function acquireStateHomeLock(stateHome: string) {
  const file = path.join(stateHome, 'server.lock')
  const lock = tryFileLock(file)
  if (!lock) throw systemErrors.STATE_HOME_LOCKED({ internal: { holderPid: holderPid(file) } })
  return lock
}

function holderPid(file: string) {
  const pid = Number.parseInt(readFileSync(file, 'utf8'), 10)
  return Number.isInteger(pid) ? pid : null
}
