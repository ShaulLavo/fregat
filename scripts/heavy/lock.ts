import { dlopen, FFIType } from 'bun:ffi'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import path from 'node:path'

const LOCK_EX = 2
const LOCK_NB = 4
const libc = dlopen('libc.so.6', {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
})

/**
 * An exclusive flock(2) on the file, or null when another process holds it. It is the
 * lock flock(1) takes, so scripts using either exclude each other. The descriptor is
 * close-on-exec: a job's children never inherit the lock, and it dies with this process.
 */
export function tryLock(file: string): number | null {
  const fd = openSync(file, 'a')
  if (libc.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0) return fd
  closeSync(fd)
  return null
}

export function unlock(fd: number) {
  closeSync(fd)
}

const MACHINE_SLOTS = [1, 2, 3] as const
const POLL_MS = 5_000
const WAIT_NOTICE_MS = 60_000

type Slot = { readonly slot: number; readonly name: string }

/**
 * The lock files a host's jobs queue on: this machine's three slots, which other tools also take
 * directly, or the Pi's one. A Pi job takes no machine slot; its slot is recorded as 0.
 */
function slotsFor(host: string): readonly Slot[] {
  if (host === 'pi') return [{ slot: 0, name: 'pi' }]
  return MACHINE_SLOTS.map((slot) => ({ slot, name: `slot${slot}` }))
}

function holders(lockDir: string, slots: readonly Slot[]) {
  return slots
    .map(({ name }) => path.join(lockDir, `${name}.holder`))
    .map((file) => (existsSync(file) ? readFileSync(file, 'utf8').trim() : ''))
    .join(';')
}

export async function acquireSlot(lockDir: string, host: string, pollMs = POLL_MS) {
  mkdirSync(lockDir, { recursive: true })
  const slots = slotsFor(host)
  const busy = host === 'pi' ? 'the Pi slot is busy' : `all ${slots.length} slots busy`
  const started = Date.now()
  let nextNotice = 0
  for (;;) {
    for (const { slot, name } of slots) {
      const fd = tryLock(path.join(lockDir, `${name}.lock`))
      if (fd !== null) return { fd, slot, holder: path.join(lockDir, `${name}.holder`) }
    }
    if (Date.now() - started >= nextNotice) {
      console.error(`[wave-heavy] ${busy}, waiting: ${holders(lockDir, slots)}`)
      nextNotice += WAIT_NOTICE_MS
    }
    await Bun.sleep(pollMs)
  }
}
