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

export function writeFixture(file: string, bytes: number, twoByte: boolean, typed = false) {
  const head = Buffer.from(`${MARKER}${twoByte ? ' →' : ''}\n`)
  const scoped = typed
    ? `{\n${CORPUS.replace('export function sum', 'const sum = function')}\n}\n`
    : CORPUS
  const corpus = twoByte ? scoped.replaceAll('total', 'totalΣ') : scoped
  const body = Buffer.from(corpus.repeat(Math.ceil(65536 / corpus.length)))
  const handle = openSync(file, 'w')
  try {
    writeSync(handle, head)
    for (let remaining = bytes - head.length - 1; remaining > 0; remaining -= body.length) {
      const length = Math.min(remaining, body.length)
      let end = length
      while (end < body.length && (body[end]! & 0xc0) === 0x80) end -= 1
      writeSync(handle, body, 0, end)
      if (end < length) writeSync(handle, Buffer.alloc(length - end, 32))
    }
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
