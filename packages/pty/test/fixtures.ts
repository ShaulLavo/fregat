import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readlinkSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test as base, expect } from 'vitest'
import { spawnPty } from '../src/index'

type SpawnOptions = Parameters<typeof spawnPty>[0]

class CapturedPty {
  readonly chunks: Uint8Array[] = []
  readonly pty: ReturnType<typeof spawnPty>

  constructor(options: Omit<SpawnOptions, 'onData'>) {
    this.pty = spawnPty({ ...options, onData: (chunk) => this.chunks.push(chunk) })
  }

  get bytes() {
    return Buffer.concat(this.chunks)
  }

  get text() {
    return this.bytes.toString()
  }

  async waitFor(text: string) {
    await expect.poll(() => this.text, { timeout: 5000 }).toContain(text)
  }
}

type Fixtures = {
  root: string
  launch: (options: Omit<SpawnOptions, 'onData'>) => CapturedPty
}

export const test = base.extend<Fixtures>({
  // Vitest requires destructuring the fixture dependencies even when none are needed.
  // oxlint-disable-next-line no-empty-pattern
  root: async ({}, provide) => {
    const basePath = existsSync('/work') ? '/work/tmp' : tmpdir()
    mkdirSync(basePath, { recursive: true })
    const root = await mkdtemp(path.join(basePath, 'pty-test-'))
    try {
      await provide(root)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  // oxlint-disable-next-line no-empty-pattern
  launch: async ({}, provide) => {
    const processes: CapturedPty[] = []
    try {
      await provide((options) => {
        const captured = new CapturedPty(options)
        processes.push(captured)
        return captured
      })
    } finally {
      await Promise.all(processes.map(({ pty }) => pty[Symbol.asyncDispose]()))
    }
  },
})

export { expect } from 'vitest'

export function childCommand(mode: string, ...args: string[]): readonly [string, ...string[]] {
  return [process.execPath, path.join(import.meta.dirname, 'fixtures/child.ts'), mode, ...args]
}

export function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function terminalDescriptors() {
  if (process.platform === 'darwin') return macTerminalDescriptors()
  if (process.platform !== 'linux') return null
  return readdirSync('/proc/self/fd').flatMap(terminalDescriptor).sort()
}

function macTerminalDescriptors() {
  const output = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(process.pid), '-Ffn'], {
    encoding: 'utf8',
  })
  expect(output).toContain(`p${process.pid}\n`)
  expect(output).toMatch(/^f\d+$/m)

  const descriptors: string[] = []
  let descriptor: string | null = null
  for (const line of output.split('\n')) {
    if (line.startsWith('f')) {
      descriptor = /^f\d+$/.test(line) ? line.slice(1) : null
      continue
    }
    if (descriptor === null || !/^n\/dev\/(?:ptmx|ttys\d+|pty[a-z\d]+)$/.test(line)) continue
    descriptors.push(descriptor)
  }
  return descriptors.sort()
}

function terminalDescriptor(descriptor: string) {
  try {
    const target = readlinkSync(`/proc/self/fd/${descriptor}`)
    return target.startsWith('/dev/pts/') || target === '/dev/ptmx' ? [descriptor] : []
  } catch {
    return []
  }
}
