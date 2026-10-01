import { readFileSync, readlinkSync, realpathSync } from 'node:fs'
import path from 'node:path'

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

type DiagnosticFileSystem = {
  read(file: string): string
  link(file: string): string
  real(file: string): string
}

// Process paths and command lines stay local; the failure surface carries fixed classes only.
export function browserProcessFacts(
  pid: number,
  executable: string,
  descriptors: readonly number[],
  fs: DiagnosticFileSystem = {
    read: (file) => readFileSync(file, 'utf8'),
    link: readlinkSync,
    real: realpathSync,
  },
) {
  const observe = (read: () => string) => {
    try {
      return read()
    } catch {
      return undefined
    }
  }
  const stat = observe(() => fs.read(`/proc/${pid}/stat`))
  const state = stat?.slice(stat.lastIndexOf(') ') + 2).split(' ')[0]
  const owner = observe(() => fs.link(`/proc/${pid}/exe`))
  const selected = observe(() => fs.real(executable))
  const name = owner ? path.basename(owner) : ''
  const descriptor = (file: string) => {
    const value = observe(() => fs.link(file))
    if (value === undefined) return 'unavailable'
    if (value.startsWith('pipe:[')) return 'pipe'
    if (value.startsWith('socket:[')) return 'socket'
    return 'other'
  }
  const executableClass = () => {
    if (!owner) return 'unavailable'
    if (['chrome', 'chromium', 'chromium-browser'].includes(name)) return 'browser'
    if (['sh', 'bash', 'dash'].includes(name)) return 'shell'
    if (name === 'snap') return 'snap'
    return 'other'
  }
  return {
    processState: state && /^[RSDTtZXIP]$/.test(state) ? state : 'unavailable',
    processExecutableClass: executableClass(),
    processMatchesSelected: Boolean(owner && selected && owner === selected),
    childWriteDescriptor: descriptor(`/proc/${pid}/fd/3`),
    childReadDescriptor: descriptor(`/proc/${pid}/fd/4`),
    parentWriteDescriptor: descriptor(`/proc/self/fd/${descriptors[0]}`),
    parentReadDescriptor: descriptor(`/proc/self/fd/${descriptors[1]}`),
  }
}
