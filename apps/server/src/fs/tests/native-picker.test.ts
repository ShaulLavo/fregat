import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NativePicker } from '../native-picker'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// A real helper process speaking the native helper's `pick` protocol.
async function helper(body: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-picker-'))
  roots.push(root)
  const file = path.join(root, 'helper')
  await writeFile(file, `#!/bin/sh\nROOT=${JSON.stringify(root)}\n${body}\n`)
  await chmod(file, 0o700)
  return { file, root }
}

function picker(file: string | null, options: { desktop?: boolean; dialogMs?: number } = {}) {
  return new NativePicker({
    helper: () => file,
    desktop: () => options.desktop ?? true,
    budget: () => ({ dialogMs: options.dialogMs ?? 5000, stopGraceMs: 200 }),
  })
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function pidFrom(root: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const text = await readFile(path.join(root, 'pid'), 'utf8').catch(() => '')
    if (text.trim()) return Number(text)
    await Bun.sleep(20)
  }
  throw new Error('helper never started')
}

const signal = () => new AbortController().signal

describe('native picker', () => {
  it('returns the chosen folder and passes the starting folder through', async () => {
    const { file, root } = await helper(
      `printf '%s' "$2" > "$ROOT/args"\necho '{"event":"picked","paths":["/home/a"]}'`,
    )
    const result = await picker(file).pick({ startingPath: '/home' }, signal())
    expect(result).toEqual({ outcome: 'selected', paths: ['/home/a'] })
    expect(JSON.parse(await readFile(path.join(root, 'args'), 'utf8'))).toEqual({
      startingPath: '/home',
    })
  })

  it('reports a dismissed chooser as cancelled', async () => {
    const { file } = await helper(`echo '{"event":"picked","paths":[]}'`)
    expect(await picker(file).pick({}, signal())).toEqual({
      outcome: 'cancelled',
      paths: [],
    })
  })

  it('keeps the helper control channel open until it reports a choice', async () => {
    const executable = `'${process.execPath.replaceAll("'", "'\\''")}'`
    const { file } = await helper(
      `exec ${executable} -e 'const event = await Promise.race([Bun.stdin.text().then(() => "closed"), Bun.sleep(50).then(() => "picked")]); console.log(JSON.stringify({ event, paths: ["/native/project"] })); process.exit(0);'`,
    )
    expect(await picker(file).pick({}, signal())).toEqual({
      outcome: 'selected',
      paths: ['/native/project'],
    })
  })

  it('is unavailable without a helper or a desktop session', async () => {
    const { file } = await helper(`echo '{"event":"picked","paths":[]}'`)
    expect(picker(null).available()).toBe(false)
    expect(picker(file, { desktop: false }).available()).toBe(false)
    expect(picker(path.join(path.dirname(file), 'missing')).available()).toBe(false)
    await expect(picker(file, { desktop: false }).pick({}, signal())).rejects.toMatchObject({
      code: 'system.NATIVE_PICKER_UNAVAILABLE',
    })
  })

  it('refuses invalid options before starting a helper', async () => {
    const { file, root } = await helper(
      `touch "$ROOT/started"\necho '{"event":"picked","paths":[]}'`,
    )
    await expect(picker(file).pick({ startingPath: 'relative' }, signal())).rejects.toMatchObject({
      code: 'system.NATIVE_PICKER_INVALID_OPTIONS',
    })
    await expect(readFile(path.join(root, 'started'))).rejects.toThrow()
  })

  it('keeps one chooser open per desktop', async () => {
    const { file, root } = await helper(`echo $$ > "$ROOT/pid"\nexec sleep 30`)
    const native = picker(file)
    const controller = new AbortController()
    const first = native.pick({}, controller.signal)
    await pidFrom(root)
    await expect(native.pick({}, signal())).rejects.toMatchObject({
      code: 'system.NATIVE_PICKER_BUSY',
    })
    controller.abort()
    await expect(first).resolves.toEqual({ outcome: 'cancelled', paths: [] })
  })

  it('stops its own helper when the requester disconnects', async () => {
    const { file, root } = await helper(`echo $$ > "$ROOT/pid"\nexec sleep 30`)
    const controller = new AbortController()
    const pending = picker(file).pick({}, controller.signal)
    const pid = await pidFrom(root)
    controller.abort()
    await expect(pending).resolves.toEqual({ outcome: 'cancelled', paths: [] })
    expect(alive(pid)).toBe(false)
  })

  it('times out and stops a helper that ignores SIGTERM', async () => {
    const { file, root } = await helper(
      `trap '' TERM\necho $$ > "$ROOT/pid"\nwhile :; do sleep 0.05; done`,
    )
    const pending = picker(file, { dialogMs: 300 }).pick({}, signal())
    const pid = await pidFrom(root)
    await expect(pending).rejects.toMatchObject({ code: 'system.NATIVE_PICKER_TIMEOUT' })
    expect(alive(pid)).toBe(false)
  })

  it('fails when the helper exits without a choice or reports a relative path or several paths', async () => {
    const crash = await helper('exit 3')
    await expect(picker(crash.file).pick({}, signal())).rejects.toMatchObject({
      code: 'system.NATIVE_PICKER_FAILED',
    })
    const relative = await helper(`echo '{"event":"picked","paths":["relative"]}'`)
    await expect(picker(relative.file).pick({}, signal())).rejects.toMatchObject({
      code: 'system.NATIVE_PICKER_FAILED',
    })
    const several = await helper(`echo '{"event":"picked","paths":["/home/a","/home/b"]}'`)
    await expect(picker(several.file).pick({}, signal())).rejects.toMatchObject({
      code: 'system.NATIVE_PICKER_FAILED',
    })
  })
})
