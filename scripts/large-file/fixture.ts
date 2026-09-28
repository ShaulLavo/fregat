import { createHash } from 'node:crypto'
import { createReadStream, openSync, closeSync, writeSync } from 'node:fs'

export const MARKER = '// LARGE_FILE_BENCHMARK'
const CORPUS = `export function sum(values: readonly number[]) {
  let total = 0
  for (const value of values) {
    if (value > 0) {
      total += value
    }
  }
  return total
}
`

export function writeFixture(file: string, bytes: number, twoByte: boolean) {
  const head = Buffer.from(`${MARKER}${twoByte ? ' →' : ''}\n`)
  const body = Buffer.from(CORPUS.repeat(Math.ceil(65536 / CORPUS.length)))
  const handle = openSync(file, 'w')
  try {
    writeSync(handle, head)
    for (let remaining = bytes - head.length - 1; remaining > 0; remaining -= body.length)
      writeSync(handle, body, 0, Math.min(remaining, body.length))
    writeSync(handle, Buffer.from('\n'))
  } finally {
    closeSync(handle)
  }
}

export async function expectedEditedHash(file: string, keyCount: number) {
  const hash = createHash('sha256')
  hash.update('x'.repeat(keyCount))
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function fileHash(file: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
