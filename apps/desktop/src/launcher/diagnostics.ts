const signatures = {
  sandbox:
    /No usable sandbox|Running as root without --no-sandbox|Failed to move to new namespace/i,
  display: /Missing X server|failed to connect to Wayland|Failed to initialize.*platform/i,
  singleton: /ProcessSingleton|SingletonLock/i,
  pipe: /remote debugging pipe|Remote debugging pipe|Invalid file descriptor/i,
  snap: /snap-confine|snapd|requires the chromium snap|Installing the chromium snap/i,
  dbus: /Failed to connect to the bus|dbus.*ERROR/i,
  gpu: /GPU process.*(?:exited|failed)|Failed to create.*GL|eglInitialize.*failed/i,
} as const

type Signature = keyof typeof signatures

// Browser stderr can contain paths and page data; retain only counts of fixed diagnostic classes.
export function browserDiagnostics() {
  const counts: Partial<Record<Signature, number>> = {}
  let bytes = 0
  let pending = ''
  const classify = (line: string) => {
    for (const [name, pattern] of Object.entries(signatures)) {
      if (pattern.test(line)) counts[name as Signature] = (counts[name as Signature] ?? 0) + 1
    }
  }
  return {
    add(text: string) {
      bytes += Buffer.byteLength(text)
      const lines = (pending + text).split('\n')
      pending = lines.pop()!.slice(-4096)
      for (const line of lines) classify(line)
    },
    finish() {
      classify(pending)
      pending = ''
    },
    snapshot() {
      return { stderrBytes: bytes, stderrClasses: { ...counts } }
    },
  }
}

export async function drainBrowserDiagnostics(
  stream: ReadableStream<Uint8Array>,
  diagnostics: ReturnType<typeof browserDiagnostics>,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      diagnostics.add(decoder.decode(chunk.value, { stream: true }))
    }
    diagnostics.add(decoder.decode())
  } finally {
    diagnostics.finish()
    reader.releaseLock()
  }
}
