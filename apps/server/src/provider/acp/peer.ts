import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import * as v from 'valibot'
import { acpErrors } from './structured-errors'

const rpcId = v.union([v.string(), v.number()])
const frameSchema = v.object({
  jsonrpc: v.literal('2.0'),
  id: v.optional(rpcId),
  method: v.optional(v.string()),
  params: v.optional(v.unknown()),
  result: v.optional(v.unknown()),
  error: v.optional(v.object({ code: v.number(), message: v.string() })),
})

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  detach: () => void
}

export type AcpPeerInput = {
  executable: string
  args: readonly string[]
  cwd: string
  env: NodeJS.ProcessEnv
  onNotification?: (method: string, params: unknown) => void
  onRequest?: (method: string, params: unknown) => Promise<unknown>
}

/** A peer owns its child and pending RPCs. Disposing one never touches another peer. */
export class AcpPeer {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<string | number, Pending>()
  private delivery = Promise.resolve()
  private nextId = 0
  private closed = false
  private readonly exited = Promise.withResolvers<void>()

  private readonly input: AcpPeerInput

  constructor(input: AcpPeerInput) {
    this.input = input
    this.child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: 'pipe',
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    // Drain stderr without retaining account information or provider output in errors.
    this.child.stderr.resume()
    this.child.stderr.on('error', () => this.fail('stderr'))
    this.child.stdout.on('error', () => this.fail('stdout'))
    this.child.stdin.on('error', () => this.fail('stdin'))
    this.child.on('error', () => {
      this.fail('spawn')
      this.exited.resolve()
    })
    this.child.on('exit', (code, signal) => {
      this.fail('exit', { exitCode: code, signal })
      this.exited.resolve()
    })
    const lines = createInterface({ input: this.child.stdout })
    lines.on('line', (line) => this.receive(line))
    lines.on('close', () => this.fail('stdout-eof'))
    this.child.once('close', () => lines.close())
  }

  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) return Promise.reject(acpErrors.CLOSED({ internal: { operation: method } }))
    if (signal?.aborted)
      return Promise.reject(acpErrors.ABORTED({ internal: { operation: method } }))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id)
        detach()
        reject(acpErrors.ABORTED({ internal: { operation: method } }))
      }
      const detach = () => signal?.removeEventListener('abort', abort)
      this.pending.set(id, { resolve, reject, detach })
      signal?.addEventListener('abort', abort, { once: true })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params: unknown) {
    if (this.closed) return
    this.write({ method, params })
  }

  async dispose() {
    if (!this.closed) this.fail('dispose')
    this.kill()
    await this.exited.promise
  }

  private kill() {
    const pid = this.child.pid
    if (!pid) return
    try {
      if (process.platform === 'win32') this.child.kill('SIGKILL')
      else process.kill(-pid, 'SIGKILL')
    } catch {
      // Exit may race disposal; the exit event still releases the waiter.
    }
  }

  private write(frame: Record<string, unknown>) {
    if (this.closed) return
    this.delivery = this.delivery.then(() => this.deliver(frame))
    void this.delivery.catch(() => this.fail('stdin'))
  }

  private deliver(frame: Record<string, unknown>): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (typeof frame.id === 'number' && frame.method && !this.pending.has(frame.id))
      return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`, (error) => {
        if (error) {
          reject(acpErrors.CLOSED({ internal: { reason: 'stdin-write' } }))
          return
        }
        resolve()
      })
    })
  }

  private receive(line: string) {
    if (this.closed) return
    let decoded: v.InferOutput<typeof frameSchema>
    try {
      decoded = v.parse(frameSchema, JSON.parse(line))
    } catch {
      this.fail('decode')
      void this.dispose()
      return
    }
    if (decoded.method) {
      this.receiveMethod(decoded)
      return
    }
    if (decoded.id === undefined) {
      this.fail('missing-id')
      void this.dispose()
      return
    }
    const pending = this.pending.get(decoded.id)
    if (!pending) return
    this.pending.delete(decoded.id)
    pending.detach()
    if (decoded.error) {
      pending.reject(acpErrors.REQUEST_FAILED({ internal: { rpcCode: decoded.error.code } }))
      return
    }
    if (!Object.hasOwn(decoded, 'result')) {
      pending.reject(acpErrors.PROTOCOL({ internal: { reason: 'missing-result' } }))
      return
    }
    pending.resolve(decoded.result)
  }

  private receiveMethod(frame: v.InferOutput<typeof frameSchema>) {
    const method = frame.method!
    if (frame.id === undefined) {
      try {
        this.input.onNotification?.(method, frame.params)
      } catch {
        this.fail('notification')
        void this.dispose()
      }
      return
    }
    const id = frame.id
    if (!this.input.onRequest) {
      this.write({ id, error: { code: -32601, message: 'Method unavailable' } })
      return
    }
    void Promise.resolve()
      .then(() => this.input.onRequest!(method, frame.params))
      .then(
        (result) => this.write({ id, result }),
        () => this.write({ id, error: { code: -32603, message: 'Request failed' } }),
      )
  }

  private fail(reason: string, facts: Record<string, unknown> = {}) {
    if (this.closed) return
    this.closed = true
    const error =
      reason === 'decode' || reason === 'missing-id' || reason === 'notification'
        ? acpErrors.PROTOCOL({ internal: { reason } })
        : acpErrors.CLOSED({ internal: { reason, ...facts } })
    for (const pending of this.pending.values()) {
      pending.detach()
      pending.reject(error)
    }
    this.pending.clear()
    this.kill()
  }
}
