import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { observeNativeBuild } from './native-build-observation'

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'native-observation-'))
  const file = path.join(root, 'phases.jsonl')
  const fd = openSync(file, 'wx')
  return { root, file, fd, sink: (line: string) => writeSync(fd, line) }
}

test('real success and nonzero child results, receiver and arguments pass through unchanged', () => {
  const io = fixture()
  const original = Bun.spawnSync
  let actual: unknown
  let receiver: unknown
  let argumentsSeen: unknown[] = []
  const tap = new Proxy(original, {
    apply(target, thisArgument: unknown, args: unknown[]) {
      receiver = thisArgument
      argumentsSeen = args
      actual = Reflect.apply(target, thisArgument, args)
      return actual
    },
  })
  Bun.spawnSync = tap
  try {
    for (const code of [0, 7]) {
      const argv = [process.execPath, '-e', `process.exit(${code})`]
      const result = observeNativeBuild(() => Bun.spawnSync(argv), io.sink)
      expect(result).toBe(actual)
      expect(result.exitCode).toBe(code)
      expect(receiver).toBe(Bun)
      expect(argumentsSeen[0]).toBe(argv)
      expect(Bun.spawnSync).toBe(tap)
      const text = readFileSync(io.file, 'utf8')
      expect(text).toContain(`"exit":${code}`)
      expect(text).not.toContain('process.exit')
    }
  } finally {
    Bun.spawnSync = original
    closeSync(io.fd)
    rmSync(io.root, { recursive: true, force: true })
  }
})

test('a genuine external spawn Error retains identity and always restores the boundary', () => {
  const io = fixture()
  const original = Bun.spawnSync
  let primary: unknown
  const tap = new Proxy(original, {
    apply(target, receiver: unknown, args: unknown[]) {
      try {
        return Reflect.apply(target, receiver, args)
      } catch (error) {
        primary = error
        throw error
      }
    },
  })
  Bun.spawnSync = tap
  let caught: unknown
  try {
    try {
      observeNativeBuild(() => Bun.spawnSync([path.join(io.root, 'absent')]), io.sink)
    } catch (error) {
      caught = error
    }
    expect(Bun.spawnSync).toBe(tap)
    expect(primary).toBeDefined()
    expect(caught).toBe(primary)
    const text = readFileSync(io.file, 'utf8')
    expect(text).toContain('"stage":"threw"')
    expect(text).toContain('"stage":"restored"')
    expect(text).not.toContain('absent')
    expect(text).not.toContain(io.root)
  } finally {
    Bun.spawnSync = original
    closeSync(io.fd)
    rmSync(io.root, { recursive: true, force: true })
  }
})

test('failed observation IO preserves real child status, callback return and callback Error', () => {
  const io = fixture()
  closeSync(io.fd)
  const original = Bun.spawnSync
  const marker = Symbol('return')
  let primary: unknown
  let caught: unknown
  try {
    const result = observeNativeBuild(() => {
      const child = Bun.spawnSync([process.execPath, '-e', 'process.exit(7)'])
      expect(child.exitCode).toBe(7)
      return marker
    }, io.sink)
    expect(result).toBe(marker)
    expect(Bun.spawnSync).toBe(original)
    try {
      observeNativeBuild(() => {
        try {
          readFileSync(path.join(io.root, 'absent'))
        } catch (error) {
          primary = error
          throw error
        }
      }, io.sink)
    } catch (error) {
      caught = error
    }
    expect(primary).toBeDefined()
    expect(caught).toBe(primary)
    expect(Bun.spawnSync).toBe(original)
    expect(readFileSync(io.file).byteLength).toBe(0)
  } finally {
    rmSync(io.root, { recursive: true, force: true })
  }
})

test('phase records are synchronous, closed and capped before primary callback completion', () => {
  const io = fixture()
  const original = Bun.spawnSync
  try {
    const marker = Symbol('return')
    const result = observeNativeBuild((phase) => {
      phase('build', 'before')
      expect(readFileSync(io.file, 'utf8')).toContain('"boundary":"build","stage":"before"')
      Reflect.apply(phase, undefined, ['private-file-body', 'before'])
      for (let count = 0; count < 200; count++) phase('build', 'before')
      return marker
    }, io.sink)
    expect(result).toBe(marker)
    expect(Bun.spawnSync).toBe(original)
    const raw = readFileSync(io.file)
    const lines = raw.toString().trim().split('\n')
    expect(raw.byteLength).toBeLessThanOrEqual(8192)
    expect(lines.length).toBeLessThanOrEqual(16)
    expect(lines.every((line) => Buffer.byteLength(line + '\n') <= 1024)).toBe(true)
    expect(lines.at(-1)).toContain('"stage":"limit"')
    expect(lines.at(-1)).toContain('"refused":1')
    expect(raw.toString()).not.toContain('private-file-body')
  } finally {
    closeSync(io.fd)
    rmSync(io.root, { recursive: true, force: true })
  }
})

test.skipIf(process.platform === 'win32')(
  'a genuine signal preserves its native result and available signal facts',
  () => {
    const io = fixture()
    const original = Bun.spawnSync
    let primary: unknown
    const tap = new Proxy(original, {
      apply(target, receiver: unknown, args: unknown[]) {
        primary = Reflect.apply(target, receiver, args)
        return primary
      },
    })
    Bun.spawnSync = tap
    try {
      const result = observeNativeBuild(
        () => Bun.spawnSync([process.execPath, '-e', "process.kill(process.pid, 'SIGTERM')"]),
        io.sink,
      )
      expect(result).toBe(primary)
      expect(Bun.spawnSync).toBe(tap)
      const lines = readFileSync(io.file, 'utf8').trim().split('\n')
      const after = lines.find((line) => line.includes('"boundary":"other","stage":"after"'))
      expect(after).toBeDefined()
      expect(after).toContain(`"exit":${result.exitCode}`)
      const signal = Object.getOwnPropertyDescriptor(result, 'signalCode')?.value
      if (typeof signal === 'string') expect(after).toContain(`"signal":"${signal}"`)
      if (signal === undefined) expect(after).toContain('"signalAvailable":false')
    } finally {
      Bun.spawnSync = original
      closeSync(io.fd)
      rmSync(io.root, { recursive: true, force: true })
    }
  },
)
