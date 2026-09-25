import { spawnPty, type Pty, type PtyExit } from '@workspace/pty'

import { RING_BYTES, type HostSessionInfo } from './protocol'

export type SessionSubscriber = {
  output(session: HostSession, offset: number, bytes: Uint8Array): void
  gap(session: HostSession, from: number, to: number): void
  exited(session: HostSession, exit: PtyExit): void
}

export type HostSessionOptions = {
  readonly id: number
  readonly key: string
  readonly command: readonly [string, ...string[]]
  readonly cwd?: string
  readonly env: Readonly<Record<string, string>>
  readonly cols: number
  readonly rows: number
  readonly onExit: (session: HostSession) => void
}

type Chunk = { readonly offset: number; readonly bytes: Uint8Array }

/** One shell and the output ring that covers a server's absence. Offsets only grow. */
export class HostSession {
  readonly id: number
  readonly key: string
  readonly startedAt = new Date().toISOString()
  readonly pty: Pty
  private readonly subscribers = new Set<SessionSubscriber>()
  private readonly chunks: Chunk[] = []
  private ringBytes = 0
  private end = 0
  exit: PtyExit | null = null

  constructor(options: HostSessionOptions) {
    this.id = options.id
    this.key = options.key
    this.pty = spawnPty({
      command: options.command,
      cwd: options.cwd,
      env: options.env,
      cols: options.cols,
      rows: options.rows,
      onData: (bytes) => this.append(bytes),
    })
    this.pty.exited.then(
      (exit) => this.finish(exit, options.onExit),
      () => this.finish({ exitCode: 1, signal: null }, options.onExit),
    )
  }

  get pid() {
    return this.pty.pid
  }

  get offset() {
    return this.end
  }

  replayStats(from: number) {
    const start = this.chunks[0]?.offset ?? this.end
    const replayFrom = Math.min(from, this.end)
    return {
      replayedBytes: this.end - Math.max(start, replayFrom),
      gapBytes: Math.max(0, start - replayFrom),
    }
  }

  get subscriberCount() {
    return this.subscribers.size
  }

  info(): HostSessionInfo {
    return {
      key: this.key,
      session: this.id,
      pid: this.pid,
      startedAt: this.startedAt,
      offset: this.end,
      exited: this.exit !== null,
    }
  }

  subscribe(subscriber: SessionSubscriber) {
    this.subscribers.add(subscriber)
  }

  /** Replays from `from`, or from the ring's start with one gap when the ring dropped it. */
  attach(subscriber: SessionSubscriber, from: number) {
    this.subscribers.add(subscriber)
    const start = this.chunks[0]?.offset ?? this.end
    const replayFrom = Math.min(from, this.end)
    if (replayFrom < start) subscriber.gap(this, replayFrom, start)
    for (const chunk of this.chunks) {
      const chunkEnd = chunk.offset + chunk.bytes.byteLength
      if (chunkEnd <= replayFrom) continue
      const skip = Math.max(0, replayFrom - chunk.offset)
      subscriber.output(this, chunk.offset + skip, chunk.bytes.subarray(skip))
    }
    if (this.exit) subscriber.exited(this, this.exit)
  }

  unsubscribe(subscriber: SessionSubscriber) {
    this.subscribers.delete(subscriber)
  }

  private append(data: Uint8Array) {
    // Copied: the ring outlives the callback, and the runtime may reuse its buffer.
    const bytes = data.slice()
    const offset = this.end
    this.end += bytes.byteLength
    this.remember({ offset, bytes })
    for (const subscriber of this.subscribers) subscriber.output(this, offset, bytes)
  }

  private remember(chunk: Chunk) {
    const kept = chunk.bytes.byteLength > RING_BYTES ? keepTail(chunk) : chunk
    this.chunks.push(kept)
    this.ringBytes += kept.bytes.byteLength
    while (this.ringBytes > RING_BYTES) this.dropHead()
  }

  private dropHead() {
    const head = this.chunks[0]
    if (!head) return
    const excess = this.ringBytes - RING_BYTES
    if (head.bytes.byteLength <= excess) {
      this.chunks.shift()
      this.ringBytes -= head.bytes.byteLength
      return
    }
    this.chunks[0] = { offset: head.offset + excess, bytes: head.bytes.subarray(excess) }
    this.ringBytes -= excess
  }

  private finish(exit: PtyExit, onExit: (session: HostSession) => void) {
    this.exit = exit
    for (const subscriber of this.subscribers) subscriber.exited(this, exit)
    onExit(this)
  }
}

function keepTail(chunk: Chunk): Chunk {
  const skip = chunk.bytes.byteLength - RING_BYTES
  return { offset: chunk.offset + skip, bytes: chunk.bytes.subarray(skip) }
}
