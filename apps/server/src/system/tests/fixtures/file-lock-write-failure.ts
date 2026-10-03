import assert from 'node:assert/strict'
import { readdirSync, readlinkSync } from 'node:fs'
import { tryFileLock } from '../../file-lock'

const file = process.argv[2]
assert(file)

function isLockDescriptor(fd: string) {
  try {
    return readlinkSync(`/proc/self/fd/${fd}`) === file
  } catch {
    return false
  }
}

assert.throws(() => tryFileLock(file), { code: 'EFBIG' })
assert.throws(() => tryFileLock(file), { code: 'EFBIG' })
if (process.platform === 'linux') {
  assert.equal(readdirSync('/proc/self/fd').filter(isLockDescriptor).length, 0)
}
