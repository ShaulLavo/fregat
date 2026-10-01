import { writeFileSync } from 'node:fs'
import { acquireSlot, DEFAULT_LOCK_DIR } from '../lock'

/**
 * Takes the Pi lock the heavy wrapper's `--host pi` jobs take, for the rest of this process, so
 * a sync never replaces the lane checkout under a running job and two jobs never share the Pi.
 * The wrapper's launcher runs under the wrapper's hold and does not call this.
 */
export async function holdLaneLock(who: string, lockDir = DEFAULT_LOCK_DIR) {
  const { holder } = await acquireSlot(lockDir, 'pi')
  const since = new Date().toTimeString().slice(0, 8)
  writeHolder(holder, `${who} pid=${process.pid} since=${since} cwd=${process.cwd()}\n`)
  process.on('exit', () => writeHolder(holder, ''))
}

// The holder line is advisory; failing to write it must not give up the lock.
function writeHolder(file: string, line: string) {
  try {
    writeFileSync(file, line)
  } catch (error) {
    console.error(`[pi-lane] could not write ${file}: ${String(error)}`)
  }
}
