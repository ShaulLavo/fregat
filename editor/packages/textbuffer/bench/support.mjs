import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const benchRoot = fileURLToPath(new URL('.', import.meta.url))
export const packageRoot = path.resolve(benchRoot, '..')
export const pin = JSON.parse(readFileSync(path.join(benchRoot, 'upstream.json'), 'utf8'))
export const upstreamRoot = path.join(benchRoot, '.cache', pin.commit)

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const gitBlobHash = (bytes) =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')

export function fileHashes(root, accept = () => true) {
  const hashes = {}
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith('.') || entry.name === 'results') continue
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(filename)
      else if (accept(filename))
        hashes[path.relative(root, filename).split(path.sep).join('/')] = sha256(
          readFileSync(filename),
        )
    }
  }
  visit(root)
  return hashes
}

export function statistics(values) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value)))
    throw new Error('Invalid samples')
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return {
    count: values.length,
    min: sorted[0],
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted[sorted.length - 1],
    mean: values.reduce((total, value) => total + value, 0) / values.length,
  }
}

export function consume(value, checksum = 2166136261) {
  if (typeof value === 'string') {
    checksum = consume(value.length, checksum)
    if (value.length) {
      checksum = consume(value.charCodeAt(0), checksum)
      checksum = consume(value.charCodeAt(Math.floor(value.length / 2)), checksum)
      checksum = consume(value.charCodeAt(value.length - 1), checksum)
    }
    return checksum
  }
  if (typeof value === 'number') return Math.imul(checksum ^ value, 16777619) >>> 0
  return consume(value.column, consume(value.row, checksum))
}
