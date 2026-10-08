export type StderrFailure = { readonly kind: 'read' | 'write'; readonly code: string | null }
type ScopeDiagnostics = {
  readonly transportFailed: boolean
  readonly failure: StderrFailure | null
  readonly truncated: boolean
}

const TRANSPORT = 'Failed to start transient scope unit: Transport endpoint is not connected'
const cancelled = Symbol('cancelled')

/** The launcher owns stderr until the shim restores the payload's original descriptor. */
export function scopeDiagnostics(stderr: Bun.Subprocess['stderr']) {
  const controller = new AbortController()
  const done = relay(stderr, controller.signal)
  return {
    finish: async (graceMs: number) => {
      const timer = setTimeout(() => controller.abort(), graceMs)
      try {
        return await done
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

async function relay(
  stderr: Bun.Subprocess['stderr'],
  signal: AbortSignal,
): Promise<ScopeDiagnostics> {
  if (!stderr || typeof stderr === 'number') {
    return { transportFailed: false, failure: null, truncated: false }
  }
  const reader = stderr.getReader()
  const decoder = new TextDecoder()
  let transportFailed = false
  let failure: StderrFailure | null = null
  let tail = ''
  let cancel = () => {}
  const aborted = new Promise<typeof cancelled>((resolve) => {
    cancel = () => {
      resolve(cancelled)
      void reader.cancel().catch(() => {})
    }
    signal.addEventListener('abort', cancel, { once: true })
  })
  try {
    for (;;) {
      const read = await Promise.race([
        reader.read().then(
          (value) => ({ kind: 'read' as const, value }),
          (error: unknown) => ({ kind: 'error' as const, error }),
        ),
        aborted,
      ])
      if (read === cancelled) break
      if (read.kind === 'error') {
        failure ??= stderrFailure('read', read.error)
        break
      }
      if (read.value.done) break
      const chunk = read.value.value
      const text = tail + decoder.decode(chunk, { stream: true })
      transportFailed ||= text.includes(TRANSPORT)
      tail = text.slice(1 - TRANSPORT.length)
      if (failure) continue
      const write = await Promise.race([
        Promise.resolve()
          .then(() => Bun.write(Bun.stderr, chunk))
          .then(
            () => ({ kind: 'written' as const }),
            (error: unknown) => ({ kind: 'error' as const, error }),
          ),
        aborted,
      ])
      if (write === cancelled) {
        failure = { kind: 'write', code: 'ABORT_ERR' }
        break
      }
      if (write.kind === 'error') failure = stderrFailure('write', write.error)
    }
    return { transportFailed, failure, truncated: signal.aborted }
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

function stderrFailure(kind: StderrFailure['kind'], error: unknown): StderrFailure {
  const code = (error as { code?: unknown } | null)?.code
  return { kind, code: typeof code === 'string' ? code : null }
}
