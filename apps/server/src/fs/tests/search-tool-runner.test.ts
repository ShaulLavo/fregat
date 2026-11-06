import { afterEach, describe, expect, onTestFinished, test, vi } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  canUseSearchTools,
  createCommandAvailability,
  runToolLines,
  type SearchToolWarning,
} from '../search-tool-runner'

describe('search tool runner', () => {
  test('runs an uncancelled child and observes its exit', async () => {
    const fixture = await toolFixture('console.log("found")', new AbortController().signal)

    expect(await collect(fixture.lines)).toEqual(['found'])
    const pid = await fixturePid(fixture.pidFile)
    expect(pid).toBeGreaterThan(0)
    expect(isAlive(pid)).toBe(false)
  })

  test.for(['before creation', 'before first iteration'])(
    'skips a child cancelled %s',
    async (when) => {
      const controller = new AbortController()
      if (when === 'before creation') controller.abort()
      const fixture = await toolFixture('console.log("found")', controller.signal)
      controller.abort()

      const lines = await collect(fixture.lines)

      expect(await fixturePid(fixture.pidFile)).toBe(0)
      expect(lines).toEqual([])
    },
  )

  test('stops a running child when the stream is cancelled', async () => {
    const controller = new AbortController()
    const fixture = await toolFixture(
      'console.log("ready"); setInterval(() => {}, 1_000)',
      controller.signal,
    )
    expect(await fixture.lines.next()).toEqual({ done: false, value: 'ready' })
    const pid = await fixturePid(fixture.pidFile)
    expect(isAlive(pid)).toBe(true)

    controller.abort()

    expect(await collect(fixture.lines)).toEqual([])
    expect(isAlive(pid)).toBe(false)
  })

  test('stops its child when the consumer finishes early', async () => {
    const fixture = await toolFixture('console.log("ready"); setInterval(() => {}, 1_000)')
    expect(await fixture.lines.next()).toEqual({ done: false, value: 'ready' })
    const pid = await fixturePid(fixture.pidFile)
    expect(isAlive(pid)).toBe(true)

    await fixture.lines.return(undefined)

    await expect.poll(() => isAlive(pid)).toBe(false)
  })

  test('reports a tolerated failure to the caller instead of only the log', async () => {
    const warnings: SearchToolWarning[] = []

    const lines = await collect(
      runToolLines(
        process.execPath,
        ['-e', 'console.log("found"); console.error("denied"); process.exit(2)'],
        undefined,
        [0],
        [2],
        {
          onWarning: (warning) => warnings.push(warning),
        },
      ),
    )

    expect(lines).toEqual(['found'])
    expect(warnings).toEqual([
      { code: 2, command: process.execPath, stderrTail: expect.stringContaining('denied') },
    ])
  })

  test('stays silent when the tool succeeds', async () => {
    const warnings: SearchToolWarning[] = []

    const lines = await collect(
      runToolLines(process.execPath, ['-e', 'console.log("found")'], undefined, [0], [2], {
        onWarning: (warning) => warnings.push(warning),
      }),
    )

    expect(lines).toEqual(['found'])
    expect(warnings).toEqual([])
  })

  test('still throws for an exit code that is not tolerated', async () => {
    await expect(
      collect(
        runToolLines(
          process.execPath,
          ['-e', 'console.error("boom"); process.exit(3)'],
          undefined,
          [0],
        ),
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_FAILED' })
  })
})

async function toolFixture(source: string, signal?: AbortSignal) {
  const root = await mkdtemp(path.join(tmpdir(), 'search-tool-fixture-'))
  const pidFile = path.join(root, 'pid')
  const script = `import { writeFileSync } from 'node:fs';
    writeFileSync(process.argv[1], String(process.pid));
    ${source}`
  const lines = runToolLines(process.execPath, ['-e', script, pidFile], signal, [0])
  onTestFinished(async () => {
    try {
      const pid = await fixturePid(pidFile)
      if (isAlive(pid)) process.kill(pid, 'SIGKILL')
      await lines.return(undefined)
      await expect.poll(() => isAlive(pid)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  return { lines, pidFile }
}

async function fixturePid(pidFile: string) {
  return Number(await readFile(pidFile, 'utf8').catch(() => '0'))
}

function isAlive(pid: number) {
  if (pid === 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function collect(lines: AsyncIterable<string>) {
  const result: string[] = []
  for await (const line of lines) result.push(line)

  return result
}

describe('command availability', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  test('shares concurrent checks and retries rejected acquisition', async () => {
    const client = new QueryClient()
    const check = vi.fn(async () => true).mockRejectedValueOnce(new Error('fixture failure'))
    const available = createCommandAvailability(client, check)
    try {
      const failed = await Promise.allSettled([available('rg'), available('rg')])
      expect(failed.map((result) => result.status)).toEqual(['rejected', 'rejected'])
      expect(check).toHaveBeenCalledTimes(1)
      expect(await Promise.all([available('rg'), available('rg')])).toEqual([true, true])
      expect(check).toHaveBeenCalledTimes(2)
    } finally {
      client.clear()
    }
  })

  test('discovers a newly installed executable after negative expiry and separates PATH values', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const base = await mkdtemp(path.join(tmpdir(), 'platform-command-availability-'))
    try {
      vi.stubEnv('PATH', base)
      expect(await canUseSearchTools({ names: false, content: true })).toBe(false)
      await writeFile(path.join(base, 'rg'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      expect(await canUseSearchTools({ names: false, content: true })).toBe(false)
      vi.setSystemTime(Date.now() + 5000)
      expect(await canUseSearchTools({ names: false, content: true })).toBe(true)
      vi.stubEnv('PATH', path.join(base, 'missing'))
      expect(await canUseSearchTools({ names: false, content: true })).toBe(false)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
