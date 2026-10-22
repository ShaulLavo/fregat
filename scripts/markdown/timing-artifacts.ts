import { createHash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import { link, mkdtemp, open, realpath, rm, stat, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { createScriptError } from '../structured-errors'

export type ArtifactRef = {
  readonly path: string
  readonly sha256: string
  readonly byteLength: number
}
export type RawTimingRef = ArtifactRef & { readonly recordCount: number }
type FileOptions = { readonly root: string; readonly file: string }
type FoldOptions<T> = FileOptions & {
  readonly expected: RawTimingRef
  readonly parse: (value: unknown, recordIndex: number) => T
  readonly consume: (record: T, recordIndex: number) => void | Promise<void>
}

function failure(reason: string, file: string, recordIndex?: number) {
  return createScriptError(`Timing artifact ${reason}.`, {
    internal: { file, recordIndex },
  })
}

function relativeFile(root: string, file: string) {
  const relative = path.relative(root, file)
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw failure('path escapes its evidence root', file)
  return relative.split(path.sep).join('/')
}

async function locate(options: FileOptions, writing = false) {
  const root = await realpath(options.root)
  const requested = path.resolve(root, options.file)
  relativeFile(root, requested)
  const file = writing
    ? path.join(await realpath(path.dirname(requested)), path.basename(requested))
    : await realpath(requested)
  return { file, referencePath: relativeFile(root, file) }
}

function sameFile(before: BigIntStats, after: BigIntStats) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  )
}

async function* chunks(handle: FileHandle) {
  const buffer = Buffer.allocUnsafe(64 * 1024)
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
    if (!bytesRead) return
    yield buffer.subarray(0, bytesRead)
  }
}

async function readObserved(
  options: FileOptions,
  consume: (bytes: Uint8Array) => Promise<void>,
  expectedPath?: string,
): Promise<ArtifactRef> {
  const located = await locate(options)
  if (expectedPath !== undefined && located.referencePath !== expectedPath)
    throw failure('path differs from its reference', options.file)
  const handle = await open(
    located.file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile()) throw failure('path must name a regular file', options.file)
    const hash = createHash('sha256')
    let byteLength = 0
    for await (const bytes of chunks(handle)) {
      hash.update(bytes)
      byteLength += bytes.byteLength
      await consume(bytes)
    }
    const after = await handle.stat({ bigint: true })
    const current = await stat(located.file, { bigint: true })
    if (!sameFile(before, after) || !sameFile(after, current))
      throw failure('file changed while reading', options.file)
    const again = await locate(options)
    if (again.file !== located.file) throw failure('path changed while reading', options.file)
    return { path: located.referencePath, sha256: hash.digest('hex'), byteLength }
  } finally {
    await handle.close()
  }
}

export async function hashFile(options: FileOptions): Promise<ArtifactRef> {
  return readObserved(options, async () => {})
}

function parseLine(line: string, file: string, recordIndex: number): unknown {
  try {
    return JSON.parse(line)
  } catch {
    throw failure('contains invalid JSON', file, recordIndex)
  }
}

type Lines = { pending: string; recordCount: number }
async function drainLines<T>(lines: Lines, options: FoldOptions<T>) {
  let end = lines.pending.indexOf('\n')
  while (end !== -1) {
    const line = lines.pending.slice(0, end)
    lines.pending = lines.pending.slice(end + 1)
    const index = lines.recordCount
    const record = options.parse(parseLine(line, options.file, index), index)
    await options.consume(record, index)
    lines.recordCount++
    end = lines.pending.indexOf('\n')
  }
}

function checkReference(actual: RawTimingRef, expected: RawTimingRef) {
  if (actual.sha256 !== expected.sha256)
    throw failure('SHA256 digest differs from its reference', actual.path)
  if (actual.byteLength !== expected.byteLength)
    throw failure('byte length differs from its reference', actual.path)
  if (actual.recordCount !== expected.recordCount)
    throw failure('record count differs from its reference', actual.path)
}

export async function foldJsonl<T>(options: FoldOptions<T>): Promise<RawTimingRef> {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const lines: Lines = { pending: '', recordCount: 0 }
  const artifact = await readObserved(
    options,
    async (bytes) => {
      lines.pending += decoder.decode(bytes, { stream: true })
      await drainLines(lines, options)
    },
    options.expected.path,
  )
  lines.pending += decoder.decode()
  if (lines.pending.length)
    throw failure('requires a final LF terminator', options.file, lines.recordCount)
  const actual = { ...artifact, recordCount: lines.recordCount }
  checkReference(actual, options.expected)
  return actual
}

async function writeRecords<T>(
  handle: FileHandle,
  file: string,
  records: AsyncIterable<T>,
): Promise<RawTimingRef> {
  const hash = createHash('sha256')
  let byteLength = 0
  let recordCount = 0
  for await (const record of records) {
    const json = JSON.stringify(record)
    if (json === undefined) throw failure('record must be JSON serializable', file, recordCount)
    const bytes = Buffer.from(`${json}\n`)
    await handle.writeFile(bytes)
    hash.update(bytes)
    byteLength += bytes.length
    recordCount++
  }
  await handle.sync()
  return { path: file, sha256: hash.digest('hex'), byteLength, recordCount }
}

async function writeTemporary<T>(file: string, referencePath: string, records: AsyncIterable<T>) {
  const handle = await open(file, 'wx', 0o600)
  try {
    return await writeRecords(handle, referencePath, records)
  } finally {
    await handle.close()
  }
}

export async function writeJsonl<T>(
  options: FileOptions & { readonly records: AsyncIterable<T> },
): Promise<RawTimingRef> {
  const located = await locate(options, true)
  const directory = await mkdtemp(path.join(path.dirname(located.file), '.timing-artifact-'))
  const temporary = path.join(directory, 'partial.jsonl')
  try {
    const artifact = await writeTemporary(temporary, located.referencePath, options.records)
    const again = await locate(options, true)
    if (again.file !== located.file) throw failure('path changed while writing', options.file)
    await link(temporary, located.file)
    return artifact
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
