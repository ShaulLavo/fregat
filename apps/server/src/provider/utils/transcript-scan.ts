import { createHash } from 'node:crypto'
import { open, opendir } from 'node:fs/promises'
import { join } from 'node:path'
import * as v from 'valibot'
import {
  initialTranscriptReducer,
  reduceTranscriptRecord,
  transcriptReducerSchema,
  type LocalPriceCatalog,
  type TranscriptReducer,
} from './transcript-records'
import { initialTranscriptJsonState, TranscriptJsonProjector } from './transcript-json'

const count = v.pipe(v.number(), v.integer(), v.minValue(0))
export const transcriptFileCacheSchema = v.object({
  version: v.literal(1),
  sourceId: v.string(),
  path: v.string(),
  identity: v.string(),
  size: count,
  mtimeMs: v.number(),
  cursor: count,
  prefixHash: v.string(),
  guardHash: v.string(),
  published: transcriptReducerSchema,
  draft: v.nullable(transcriptReducerSchema),
})
export type TranscriptFileCache = v.InferOutput<typeof transcriptFileCacheSchema>
export type TranscriptScanLimits = {
  readonly maxBytes: number
  readonly maxFiles: number
  readonly maxLineBytes: number
  readonly readChunkBytes: number
}
export const nativeTranscriptDriverKinds = ['claude', 'codex'] as const
export type TranscriptSource = {
  readonly id: string
  readonly driverKind: (typeof nativeTranscriptDriverKinds)[number]
  readonly roots: readonly string[]
}

export type TranscriptWalkEntry =
  | string
  | null
  | { readonly kind: 'directory' }
  | {
      readonly kind: 'error'
      readonly reason: 'absent' | 'unreadable'
    }

/** Every opened directory and entry consumes a visit; a failed child keeps its siblings queued. */
export async function* walkTranscriptRoot(root: string): AsyncGenerator<TranscriptWalkEntry> {
  const directories = [root]
  while (directories.length) {
    const directory = directories.pop()
    if (!directory) continue
    try {
      yield* readTranscriptDirectory(directory, directories)
    } catch (error) {
      const absent =
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
      yield { kind: 'error', reason: absent ? 'absent' : 'unreadable' }
    }
  }
}

async function* readTranscriptDirectory(
  directory: string,
  directories: string[],
): AsyncGenerator<TranscriptWalkEntry> {
  const handle = await opendir(directory)
  try {
    yield { kind: 'directory' }
    while (true) {
      const entry = await handle.read()
      if (!entry) return
      const path = join(directory, entry.name)
      if (entry.isDirectory()) directories.push(path)
      yield entry.isFile() && entry.name.endsWith('.jsonl') ? path : null
    }
  } finally {
    await handle.close()
  }
}

/** Atomic publication: a bounded rewrite keeps its previous complete contribution until caught up. */
export async function scanTranscriptFile(options: {
  source: TranscriptSource
  path: string
  previous?: TranscriptFileCache
  budget: number
  limits: TranscriptScanLimits
  catalog: LocalPriceCatalog
  signal: AbortSignal
}): Promise<{ file: TranscriptFileCache; bytesRead: number; complete: boolean }> {
  const { source, path, previous, limits, signal } = options
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    const identity = `${stat.dev}:${stat.ino}`
    if (
      previous &&
      previous.identity === identity &&
      previous.size === stat.size &&
      previous.mtimeMs === stat.mtimeMs &&
      !previous.draft
    ) {
      return { file: previous, bytesRead: 0, complete: true }
    }
    const prefixLength = Math.min(previous?.cursor ?? 0, 256)
    // Native JSONL resumes assume append-only writes; sampled guards cannot prove an unchanged interior.
    const resume =
      previous &&
      previous.identity === identity &&
      stat.size >= previous.cursor &&
      (previous.size !== stat.size || previous.draft) &&
      previous.prefixHash === (await hashWindow(handle, 0, prefixLength)) &&
      previous.guardHash ===
        (await hashWindow(
          handle,
          Math.max(0, previous.cursor - 256),
          Math.min(previous.cursor, 256),
        ))
    const file: TranscriptFileCache = resume
      ? structuredClone(previous)
      : {
          version: 1,
          sourceId: source.id,
          path,
          identity,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          cursor: 0,
          prefixHash: '',
          guardHash: '',
          published: previous?.published ?? initialTranscriptReducer(),
          draft: initialTranscriptReducer(),
        }
    const state = file.draft ?? structuredClone(file.published)
    file.draft = state
    // A partial UTF-8 codepoint is re-read; only complete characters enter persisted state.
    let pending = 0
    let bytesRead = 0
    const chunk = Buffer.alloc(Math.min(limits.readChunkBytes, Math.max(1, options.budget)))
    while (file.cursor < stat.size && bytesRead < options.budget) {
      signal.throwIfAborted()
      const size = Math.min(chunk.length, stat.size - file.cursor, options.budget - bytesRead)
      const read = await handle.read(chunk, 0, size, file.cursor)
      if (!read.bytesRead) break
      const buffer = chunk.subarray(0, read.bytesRead)
      pending = incompleteUtf8Bytes(buffer)
      const text = buffer.subarray(0, buffer.length - pending).toString('utf8')
      bytesRead += read.bytesRead
      file.cursor += read.bytesRead - pending
      consumeLines(
        state,
        text,
        source.driverKind,
        limits.maxLineBytes,
        options.catalog,
        createHash('sha256').update(path).digest('hex'),
      )
      if (pending && read.bytesRead === pending) break
    }
    // Re-reading a codepoint whose prefix was already decoded would corrupt text, so stop at its boundary.
    file.size = stat.size
    file.mtimeMs = stat.mtimeMs
    file.prefixHash = await hashWindow(handle, 0, Math.min(file.cursor, 256))
    file.guardHash = await hashWindow(
      handle,
      Math.max(0, file.cursor - 256),
      Math.min(file.cursor, 256),
    )
    const complete = file.cursor >= stat.size - pending
    if (complete) {
      file.published = state
      file.draft = null
    }
    return { file, bytesRead, complete }
  } finally {
    await handle.close()
  }
}

function consumeLines(
  state: TranscriptReducer,
  text: string,
  driverKind: 'claude' | 'codex',
  maxBytes: number,
  catalog: LocalPriceCatalog,
  scope: string,
) {
  let start = 0
  let newline = text.indexOf('\n')
  while (newline >= 0) {
    const projector = new TranscriptJsonProjector(state.projector, maxBytes)
    projector.write(text.slice(start, newline))
    const value = projector.finish()
    if (state.projector.oversized) state.oversizedLines++
    else if (value === undefined) state.malformedLines++
    else reduceTranscriptRecord(state, driverKind, value, catalog, scope)
    state.lines++
    state.projector = initialTranscriptJsonState()
    start = newline + 1
    newline = text.indexOf('\n', start)
  }
  new TranscriptJsonProjector(state.projector, maxBytes).write(text.slice(start))
}

async function hashWindow(handle: Awaited<ReturnType<typeof open>>, start: number, size: number) {
  const buffer = Buffer.alloc(size)
  const { bytesRead } = await handle.read(buffer, 0, size, start)
  return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex')
}

function incompleteUtf8Bytes(buffer: Buffer) {
  let index = buffer.length - 1
  while (index >= Math.max(0, buffer.length - 4) && ((buffer[index] ?? 0) & 0xc0) === 0x80) index--
  const byte = buffer[index] ?? 0
  let needed = 1
  if (byte >= 0xf0) needed = 4
  else if (byte >= 0xe0) needed = 3
  else if (byte >= 0xc0) needed = 2
  const available = buffer.length - index
  return needed > available ? available : 0
}
