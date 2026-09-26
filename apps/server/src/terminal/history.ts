import type { SessionId } from '@workspace/contracts'
import { and, asc, eq, like, lt } from 'drizzle-orm'
import type { PlatformDatabase } from '../db/client'
import { terminalHistoryChunks, terminalSessionCleanup, terminalSessionOffsets } from '../db/schema'

const MAX_BYTES = 8 * 1024 * 1024
const MAX_LINES = 5_000
const CHUNK_BYTES = 16 * 1024

type Chunk = { sequence: number; data: Buffer; lines: number }

export class TerminalHistory {
  private chunks: Chunk[]
  private sequence: number
  private cumulativeOffset: number
  private readonly database: PlatformDatabase
  private readonly owner: string

  constructor(database: PlatformDatabase, owner: string) {
    this.database = database
    this.owner = owner
    this.chunks = database
      .select()
      .from(terminalHistoryChunks)
      .where(eq(terminalHistoryChunks.owner, owner))
      .orderBy(asc(terminalHistoryChunks.sequence))
      .all()
      .map(({ sequence, data }) => ({ sequence, data, lines: lineBreaks(data) }))
    this.sequence = this.chunks.at(-1)?.sequence ?? 0
    this.cumulativeOffset =
      database
        .select({ offset: terminalSessionOffsets.offset })
        .from(terminalSessionOffsets)
        .where(eq(terminalSessionOffsets.owner, owner))
        .get()?.offset ?? 0
  }

  /** Next byte in the host stream, independent of saved scrollback length. */
  get offset() {
    return this.cumulativeOffset
  }

  values(): readonly Uint8Array[] {
    return this.chunks.map((chunk) => chunk.data)
  }

  append(bytes: Uint8Array, nextOffset = this.cumulativeOffset + bytes.length) {
    if (bytes.length === 0) return
    const next = [...this.chunks]
    let sequence = this.sequence
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const data = Buffer.from(bytes.subarray(offset, offset + CHUNK_BYTES))
      const last = next.at(-1)
      if (last && last.data.length + data.length <= CHUNK_BYTES) {
        next[next.length - 1] = {
          sequence: last.sequence,
          data: Buffer.concat([last.data, data]),
          lines: last.lines + lineBreaks(data),
        }
        continue
      }
      next.push({ sequence: ++sequence, data, lines: lineBreaks(data) })
    }
    const retained = trimHistory(next)
    const offset = nextOffset
    this.persist(retained, offset)
    this.chunks = retained
    this.sequence = sequence
    this.cumulativeOffset = offset
  }

  setOffset(offset: number) {
    this.persist(this.chunks, offset)
    this.cumulativeOffset = offset
  }

  clear({ keepOffset = false } = {}) {
    this.database.transaction((transaction) => {
      transaction
        .delete(terminalHistoryChunks)
        .where(eq(terminalHistoryChunks.owner, this.owner))
        .run()
      if (keepOffset) return
      transaction
        .delete(terminalSessionOffsets)
        .where(eq(terminalSessionOffsets.owner, this.owner))
        .run()
    })
    this.chunks = []
    if (!keepOffset) this.cumulativeOffset = 0
  }

  private persist(next: Chunk[], offset: number) {
    const previous = new Map(this.chunks.map((chunk) => [chunk.sequence, chunk]))
    this.database.transaction((transaction) => {
      transaction
        .delete(terminalHistoryChunks)
        .where(
          and(
            eq(terminalHistoryChunks.owner, this.owner),
            lt(terminalHistoryChunks.sequence, next[0]?.sequence ?? this.sequence + 1),
          ),
        )
        .run()
      for (const chunk of next) {
        if (previous.get(chunk.sequence) === chunk) continue
        transaction
          .insert(terminalHistoryChunks)
          .values({
            owner: this.owner,
            sequence: chunk.sequence,
            data: chunk.data,
          })
          .onConflictDoUpdate({
            target: [terminalHistoryChunks.owner, terminalHistoryChunks.sequence],
            set: { data: chunk.data },
          })
          .run()
      }
      transaction
        .insert(terminalSessionOffsets)
        .values({ owner: this.owner, offset })
        .onConflictDoUpdate({
          target: terminalSessionOffsets.owner,
          set: { offset },
        })
        .run()
    })
  }
}

function trimHistory(chunks: Chunk[]): Chunk[] {
  let bytes = chunks.reduce((total, chunk) => total + chunk.data.length, 0)
  let lines = chunks.reduce((total, chunk) => total + chunk.lines, 0)
  if (chunks.at(-1)?.data.at(-1) !== 10) lines += 1
  const truncated = bytes > MAX_BYTES || lines > MAX_LINES
  let start = 0
  while (start < chunks.length && (bytes > MAX_BYTES || lines > MAX_LINES)) {
    const first = chunks[start]!
    const offset = trimOffset(first.data, Math.max(0, bytes - MAX_BYTES), lines - MAX_LINES)
    const removedLines = lineBreaks(first.data.subarray(0, offset))
    bytes -= offset
    lines -= removedLines
    if (offset === first.data.length) {
      start += 1
      continue
    }
    chunks[start] = {
      sequence: first.sequence,
      data: Buffer.from(first.data.subarray(offset)),
      lines: first.lines - removedLines,
    }
  }
  const retained = chunks.slice(start)
  return truncated ? trimContinuation(retained) : retained
}

function trimOffset(data: Uint8Array, bytes: number, lines: number) {
  let offset = 0
  while (offset < data.length && (offset < bytes || lines > 0)) {
    if (data[offset] === 10) lines -= 1
    offset += 1
  }
  return offset
}

function lineBreaks(data: Uint8Array) {
  let count = 0
  for (const byte of data) if (byte === 10) count += 1
  return count
}

function trimContinuation(chunks: Chunk[]) {
  let remaining = 3
  while (remaining > 0 && chunks.length > 0) {
    const first = chunks[0]!
    let offset = 0
    while (
      offset < first.data.length &&
      offset < remaining &&
      (first.data[offset]! & 0xc0) === 0x80
    )
      offset += 1
    if (offset === 0) return chunks
    remaining -= offset
    if (offset === first.data.length) {
      chunks.shift()
      continue
    }
    chunks[0] = { ...first, data: Buffer.from(first.data.subarray(offset)) }
    return chunks
  }
  return chunks
}

/** Deletes the saved chunks and stream offsets of one session's agent terminals, in any worktree. */
export function deleteAgentHistory(database: PlatformDatabase, sessionId: SessionId) {
  // Owners are JSON `[worktreeId, kind, id]`; `%` and `_` cannot occur in a session id.
  const owners = `%,${JSON.stringify(['agent', sessionId]).slice(1)}`
  database.transaction((transaction) => {
    transaction.delete(terminalHistoryChunks).where(like(terminalHistoryChunks.owner, owners)).run()
    transaction
      .delete(terminalSessionOffsets)
      .where(like(terminalSessionOffsets.owner, owners))
      .run()
    transaction.insert(terminalSessionCleanup).values({ sessionId }).onConflictDoNothing().run()
  })
}

export function agentHistoryCleaned(database: PlatformDatabase, sessionId: SessionId) {
  return (
    database
      .select()
      .from(terminalSessionCleanup)
      .where(eq(terminalSessionCleanup.sessionId, sessionId))
      .get() !== undefined
  )
}
