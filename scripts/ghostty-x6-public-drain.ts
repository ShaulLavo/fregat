import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'

export interface DrainReceipt {
  readonly file: string
  readonly pid: number
  readonly since: string
  readonly holder: 'x6-window'
  readonly nonce: string
  readonly device: number
  readonly inode: number
  readonly text: string
}

export function acquireX6Drain(file: string): DrainReceipt {
  const pid = process.pid
  const since = new Date().toISOString()
  const nonce = randomUUID()
  const text = `pid=${pid} since=${since} holder=x6-window nonce=${nonce}\n`
  // The admitted driver acquires this hold; acquiring it before admission deadlocks the runner.
  const fd = openSync(file, 'wx', 0o600)
  const owned = fstatSync(fd)
  try {
    writeFileSync(fd, text)
    return {
      file,
      pid,
      since,
      holder: 'x6-window',
      nonce,
      device: owned.dev,
      inode: owned.ino,
      text,
    }
  } catch (cause) {
    const current = lstatSync(file)
    if (current.isFile() && current.dev === owned.dev && current.ino === owned.ino) unlinkSync(file)
    throw cause
  } finally {
    closeSync(fd)
  }
}

export function releaseX6Drain(receipt: DrainReceipt): 'released' | 'absent' | 'ownership-changed' {
  try {
    const current = lstatSync(receipt.file)
    if (!current.isFile() || current.dev !== receipt.device || current.ino !== receipt.inode)
      return 'ownership-changed'
    if (readFileSync(receipt.file, 'utf8') !== receipt.text) return 'ownership-changed'
    unlinkSync(receipt.file)
    return 'released'
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'
    throw cause
  }
}
