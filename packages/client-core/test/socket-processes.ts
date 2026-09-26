import { LspSessionPool, type LspProxyClientSession, type TerminalPtyFactory } from 'server/testing'

export function recordingPtyFactory() {
  const spawns: Parameters<TerminalPtyFactory>[0][] = []
  const processes: RecordingPty[] = []
  const factory: TerminalPtyFactory = (options) => {
    spawns.push(options)
    const process = new RecordingPty(options.onData, processes.length + 1)
    processes.push(process)
    return process
  }
  return { factory, spawns, processes }
}

type TerminalPty = Awaited<ReturnType<TerminalPtyFactory>>

class RecordingPty implements TerminalPty {
  killed = false
  readonly writes: (string | Uint8Array)[] = []
  readonly resizes: [number, number][] = []
  private readonly completion = Promise.withResolvers<Awaited<TerminalPty['exited']>>()
  readonly exited = this.completion.promise

  constructor(
    private readonly onData: Parameters<TerminalPtyFactory>[0]['onData'],
    readonly pid: number,
  ) {}

  kill(signal: NodeJS.Signals = 'SIGHUP') {
    this.killed = true
    this.completion.resolve({ exitCode: 0, signal })
  }
  write(message: string | Uint8Array) {
    this.writes.push(message)
  }
  resize(cols: number, rows: number) {
    this.resizes.push([cols, rows])
  }
  emit(message: Uint8Array) {
    if (this.killed) return
    this.onData(message)
  }
  async [Symbol.asyncDispose]() {
    this.kill()
    await this.exited
  }
}

export class RecordingLspPool extends LspSessionPool {
  readonly acquisitions: Parameters<LspSessionPool['acquire']>[] = []
  readonly clients: RecordingLspSession[] = []
  override async acquire(
    ...input: Parameters<LspSessionPool['acquire']>
  ): Promise<LspProxyClientSession> {
    this.acquisitions.push(input)
    const client = new RecordingLspSession()
    this.clients.push(client)
    return client
  }
  override disposeAll() {
    for (const client of this.clients) client.dispose()
    for (const [socket] of this.acquisitions) socket.close()
    super.disposeAll()
  }
}

class RecordingLspSession implements LspProxyClientSession {
  disposed = false
  readonly messages: unknown[] = []
  async handleClientMessage(message: string | ArrayBuffer | Uint8Array) {
    const value = typeof message === 'string' ? message : new TextDecoder().decode(message)
    this.messages.push(JSON.parse(value))
  }
  dispose() {
    this.disposed = true
  }
}
