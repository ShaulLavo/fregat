import { randomUUID } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { open, stat, type FileHandle } from 'node:fs/promises'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { recordProcessWarning } from '../observability'
import { FsError, mapNodeError } from './errors'
import { resolveExistingPath, type WorkspacePaths } from './path'
import { textFileVersion } from './version'

export type ReadSessionLimits = { maxSessions: number; maxRangeBytes: number; idleMs: number }
type Session = {
  id: string
  revision: string
  byteLength: number
  path: string
  absolutePath: string
  handle: FileHandle
  timer: ReturnType<typeof setTimeout> | undefined
}

export function defaultReadSessionLimits(): ReadSessionLimits {
  return {
    maxSessions: DEFAULT_SETTING_VALUES['files.readSessionLimit'],
    maxRangeBytes: DEFAULT_SETTING_VALUES['files.readRangeSizeKiB'] * 1024,
    idleMs: DEFAULT_SETTING_VALUES['files.readSessionIdleMinutes'] * 60_000,
  }
}

export class FileReadSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly operations = new Set<Promise<unknown>>()
  private pendingOpens = 0
  private activeReads = 0
  private closed = false

  private readonly paths: WorkspacePaths
  private readonly limits: () => ReadSessionLimits

  constructor(paths: WorkspacePaths, limits: () => ReadSessionLimits) {
    this.paths = paths
    this.limits = limits
  }

  open(path: string, signal: AbortSignal) {
    return this.track(() => this.openSession(path, signal))
  }

  read(id: string, start: number, end: number, signal: AbortSignal) {
    return this.track(() => this.readRange(id, start, end, signal))
  }

  dispose(id: string) {
    return this.track(() => this.closeSession(id))
  }

  private async closeSession(id: string) {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    clearTimeout(session.timer)
    await session.handle.close()
  }

  async close() {
    this.closed = true
    await Promise.allSettled(this.operations)
    await Promise.all([...this.sessions.keys()].map((id) => this.dispose(id)))
  }

  private async track<T>(operation: () => Promise<T>): Promise<T> {
    const pending = operation()
    this.operations.add(pending)
    try {
      return await pending
    } finally {
      this.operations.delete(pending)
    }
  }

  private async openSession(path: string, signal: AbortSignal) {
    this.assertOpen(signal)
    const occupied = this.sessions.size + this.pendingOpens
    this.assertCapacity(occupied)
    this.pendingOpens += 1
    try {
      return await this.openFile(path, signal)
    } catch (error) {
      if (error instanceof FsError || signal.aborted) throw error
      throw mapNodeError(error)
    } finally {
      this.pendingOpens -= 1
    }
  }

  private async openFile(path: string, signal: AbortSignal) {
    const target = await resolveExistingPath(this.paths, path)
    const handle = await open(target.absolutePath, 'r')
    let retained = false
    try {
      const stats = await handle.stat({ bigint: true })
      if (!stats.isFile()) throw new FsError('NOT_A_FILE')
      if (stats.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new FsError('FILE_TOO_LARGE')
      const session: Session = {
        id: randomUUID(),
        path: target.relativePath,
        absolutePath: target.absolutePath,
        handle,
        revision: revision(stats),
        byteLength: Number(stats.size),
        timer: undefined,
      }
      await this.assertRevision(session, signal)
      this.sessions.set(session.id, session)
      this.touch(session)
      retained = true
      return {
        id: session.id,
        revision: session.revision,
        byteLength: session.byteLength,
        maxRangeBytes: this.limits().maxRangeBytes,
      }
    } finally {
      if (!retained) await handle.close()
    }
  }

  private async readRange(id: string, start: number, end: number, signal: AbortSignal) {
    this.assertOpen(signal)
    const session = this.sessions.get(id)
    if (!session) throw expired(id)
    this.assertRange(session, start, end)
    this.assertCapacity(this.activeReads)
    this.activeReads += 1
    this.touch(session)
    try {
      return await this.readPage(session, start, end, signal)
    } catch (error) {
      if (signal.aborted) throw error
      if (error instanceof FsError && error.code === 'FILE_CHANGED') await this.dispose(id)
      if (error instanceof FsError) throw error
      await this.dispose(id)
      throw mapNodeError(error)
    } finally {
      this.activeReads -= 1
      if (this.sessions.has(id)) this.touch(session)
    }
  }

  private async readPage(session: Session, start: number, end: number, signal: AbortSignal) {
    await this.assertRevision(session, signal)
    this.assertRetained(session)
    const bytes = new Uint8Array(end - start)
    let offset = 0
    while (offset < bytes.length) {
      signal.throwIfAborted()
      const { bytesRead } = await session.handle.read(
        bytes,
        offset,
        bytes.length - offset,
        start + offset,
      )
      if (bytesRead === 0) throw new FsError('FILE_CHANGED')
      offset += bytesRead
    }
    await this.assertRevision(session, signal)
    this.assertRetained(session)
    return { revision: session.revision, bytes }
  }

  private async assertRevision(session: Session, signal: AbortSignal) {
    this.assertOpen(signal)
    const current = await resolveExistingPath(this.paths, session.path).catch(() => {
      throw new FsError('FILE_CHANGED')
    })
    if (current.absolutePath !== session.absolutePath) throw new FsError('FILE_CHANGED')
    const [opened, named] = await Promise.all([
      session.handle.stat({ bigint: true }),
      stat(current.absolutePath, { bigint: true }),
    ]).catch(() => {
      throw new FsError('FILE_CHANGED')
    })
    this.assertOpen(signal)
    if (revision(opened) !== session.revision || revision(named) !== session.revision)
      throw new FsError('FILE_CHANGED')
  }

  private assertRetained(session: Session) {
    if (this.sessions.get(session.id) !== session) throw expired(session.id)
  }

  private assertOpen(signal: AbortSignal) {
    signal.throwIfAborted()
    if (this.closed) throw expired('closed')
  }

  private assertCapacity(occupied: number) {
    const limit = this.limits().maxSessions
    if (occupied < limit) return
    throw new FsError('READ_SESSION_LIMIT', undefined, undefined, {
      internal: { occupied, limit },
      why: 'The server has reached its limit for simultaneous file reads.',
      fix: 'Close a large-file view or retry when the current reads finish.',
    })
  }

  private assertRange(session: Session, start: number, end: number) {
    const maxRangeBytes = this.limits().maxRangeBytes
    if (
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 0 &&
      end >= start &&
      end <= session.byteLength &&
      end - start <= maxRangeBytes
    )
      return
    throw new FsError('READ_RANGE_INVALID', undefined, undefined, {
      internal: { start, end, byteLength: session.byteLength, maxRangeBytes },
      why: 'The requested byte range exceeds the file or page size limit.',
      fix: 'Reload the file view to request a new page.',
    })
  }

  private touch(session: Session) {
    clearTimeout(session.timer)
    session.timer = setTimeout(() => {
      void this.dispose(session.id).catch((error: unknown) =>
        recordProcessWarning('fs.read_session_close_failed', { error }),
      )
    }, this.limits().idleMs)
    session.timer.unref?.()
  }
}

function revision(stats: BigIntStats) {
  return `range:${textFileVersion([stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':'))}`
}

function expired(id: string) {
  return new FsError('READ_SESSION_EXPIRED', undefined, undefined, {
    internal: { sessionId: id },
    why: 'The file read session has closed or expired.',
    fix: 'Reopen the file to start a new read session.',
  })
}
