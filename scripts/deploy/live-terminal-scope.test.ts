import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { expect, test } from 'vitest'
import { withTerminalCheck } from './live-terminal-scope'

test('preserves the owned directory when resource cleanup rejects', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'live-terminal-cleanup-'))
  let owned = ''
  try {
    await expect(
      withTerminalCheck(
        directory,
        async (created) => {
          owned = created
        },
        async () => {
          throw new DOMException('Cleanup failed', 'AbortError')
        },
      ),
    ).rejects.toThrow('Cleanup failed')
    expect(existsSync(owned)).toBe(true)
    expect(existsSync(directory)).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test.each(['SIGTERM', 'SIGINT'] as const)(
  'awaits cleanup and removes the outer directory on %s',
  async (signal) => {
    const parent = await mkdtemp(path.join(tmpdir(), 'live-terminal-signal-'))
    const fixture = path.join(parent, 'worker.ts')
    const finished = path.join(parent, 'finished')
    await writeFile(
      fixture,
      `
    import { writeFile } from 'node:fs/promises'
    import { withTerminalCheck } from ${JSON.stringify(path.join(import.meta.dirname, 'live-terminal-scope.ts'))}
    await withTerminalCheck(${JSON.stringify(parent)}, async (_directory, signal) => {
      console.log('ready')
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    }, async () => {
      await Bun.sleep(100)
      await writeFile(${JSON.stringify(finished)}, 'cleaned')
    })
  `,
    )
    const child = Bun.spawn([process.execPath, fixture], { stdout: 'pipe', stderr: 'pipe' })
    try {
      const reader = child.stdout.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready')
      reader.releaseLock()
      child.kill(signal)
      expect(await child.exited).toBe(0)
      expect(existsSync(finished)).toBe(true)
      expect(
        (await readdir(parent)).filter((name) => name.startsWith('fregat-live-terminal-')),
      ).toEqual([])
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      await child.exited
      await rm(parent, { recursive: true, force: true })
    }
  },
)

// Playwright's default SIGINT handler exits after closing its browser, ahead of owned cleanup.
test.skipIf(!existsSync(chromium.executablePath()))(
  'SIGINT with a live browser waits for owned cleanup before the worker exits',
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'live-browser-signal-'))
    const fixture = path.join(directory, 'worker.ts')
    const ready = path.join(directory, 'ready')
    const finished = path.join(directory, 'finished')
    await writeFile(
      fixture,
      `
      import { writeFile } from 'node:fs/promises'
      import { chromium } from ${JSON.stringify(createRequire(import.meta.url).resolve('playwright'))}
      import { openLiveBrowser } from ${JSON.stringify(path.join(import.meta.dirname, 'live-browser.mjs'))}
      import { withTerminalCheck } from ${JSON.stringify(path.join(import.meta.dirname, 'live-terminal-scope.ts'))}
      let browser
      await withTerminalCheck(${JSON.stringify(directory)}, async (_directory, signal) => {
        browser = (await openLiveBrowser(chromium, process.platform, signal)).browser
        const cancelled = new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
        await writeFile(${JSON.stringify(ready)}, 'ready')
        await cancelled
      }, async () => {
        await browser?.close()
        await Bun.sleep(300)
        await writeFile(${JSON.stringify(finished)}, 'cleaned')
      })
      `,
    )
    const child = Bun.spawn([process.execPath, fixture], { stdout: 'pipe', stderr: 'pipe' })
    try {
      await expect.poll(() => existsSync(ready), { timeout: 15_000 }).toBe(true)
      child.kill('SIGINT')
      expect(await child.exited).toBe(0)
      expect(existsSync(finished)).toBe(true)
      expect(
        (await readdir(directory)).filter((name) => name.startsWith('fregat-live-terminal-')),
      ).toEqual([])
    } finally {
      if (child.exitCode === null) child.kill('SIGTERM')
      await child.exited
      await rm(directory, { recursive: true, force: true })
    }
  },
  60_000,
)
