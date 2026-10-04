import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { browserAvailable } from './browser-launch'

await browserAvailable('chromium')
const core = createRequire(import.meta.resolve('playwright'))('playwright-core/lib/coreBundle') as {
  registry: {
    registry: {
      findExecutable(name: string): { directory: string; executablePath(): string }
    }
  }
}
const full = core.registry.registry.findExecutable('chromium')
const shell = core.registry.registry.findExecutable('chromium-headless-shell')
const launcher = new URL('./browser-launch.ts', import.meta.url).href
const prerequisite = new URL('./browser-prerequisites.ts', import.meta.url).href

if (!existsSync(shell.executablePath()))
  console.info('Shell-only cache proof requires an installed Playwright Chromium headless shell.')
if (!existsSync(full.executablePath()))
  console.info('Full-only cache proof requires an installed Playwright Chromium.')

async function withCache(
  browsers: readonly { directory: string }[],
  action: (cache: string) => Promise<void>,
) {
  const cache = await mkdtemp(path.join(tmpdir(), 'fregat-browser-cache-'))
  try {
    for (const browser of browsers)
      await symlink(
        browser.directory,
        path.join(cache, path.basename(browser.directory)),
        'junction',
      )
    await action(cache)
  } finally {
    await rm(cache, { recursive: true, force: true })
  }
}

function probe(cache: string) {
  const source = `
    import { browserAvailable, launchBrowser } from ${JSON.stringify(launcher)}
    const { chromiumUnavailable } = await import(${JSON.stringify(prerequisite)})
    const available = await browserAvailable('chromium')
    const headedAvailable = await browserAvailable('chromium', true)
    const notificationsAvailable = await browserAvailable('chromium', false, true)
    let text = null
    let error = null
    try {
      const browser = await launchBrowser('chromium', false)
      try {
        const page = await browser.newPage()
        await page.setContent('<p>cache fixture</p>')
        text = await page.locator('p').textContent()
      } finally {
        await browser.close()
      }
    } catch (failure) {
      error = String(failure)
    }
    console.log('CACHE_RESULT=' + JSON.stringify({
      available, headedAvailable, notificationsAvailable, chromiumUnavailable, text, error,
    }))
  `
  const result = spawnSync('bun', ['--eval', source], {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cache },
    encoding: 'utf8',
  })
  expect(result.status, result.stdout + result.stderr).toBe(0)
  const line = result.stdout.split('\n').find((value) => value.startsWith('CACHE_RESULT='))
  expect(line, result.stdout + result.stderr).toBeDefined()
  return JSON.parse(line!.slice('CACHE_RESULT='.length)) as {
    available: boolean
    headedAvailable: boolean
    notificationsAvailable: boolean
    chromiumUnavailable: boolean
    text: string | null
    error: string | null
  }
}

test('empty cache reports absence and preserves the missing-executable launch error', async () => {
  await withCache([], async (cache) => {
    const result = probe(cache)
    expect(result.available).toBe(false)
    expect(result.headedAvailable).toBe(false)
    expect(result.notificationsAvailable).toBe(false)
    expect(result.chromiumUnavailable).toBe(true)
    expect(result.error).toContain("Executable doesn't exist")
    expect(result.text).toBeNull()
  })
})

test.skipIf(!existsSync(shell.executablePath()))(
  'shell-only cache runs the default headless fixture',
  async () => {
    await withCache([shell], async (cache) => {
      const result = probe(cache)
      expect(result.available).toBe(true)
      expect(result.headedAvailable).toBe(false)
      expect(result.notificationsAvailable).toBe(false)
      expect(result.chromiumUnavailable).toBe(false)
      expect(result.error).toBeNull()
      expect(result.text).toBe('cache fixture')
    })
  },
)

test.skipIf(!existsSync(full.executablePath()))(
  'full-only cache reports default headless absence and full-browser mode availability',
  async () => {
    await withCache([full], async (cache) => {
      const result = probe(cache)
      expect(result.available).toBe(false)
      expect(result.headedAvailable).toBe(true)
      expect(result.notificationsAvailable).toBe(true)
      expect(result.chromiumUnavailable).toBe(true)
      expect(result.error).toContain("Executable doesn't exist")
      expect(result.text).toBeNull()
    })
  },
)

test('an existing broken executable stays available and its launch failure stays observable', async () => {
  await withCache([], async (cache) => {
    const executable = path.join(
      cache,
      path.basename(shell.directory),
      path.relative(shell.directory, shell.executablePath()),
    )
    await mkdir(path.dirname(executable), { recursive: true })
    await writeFile(executable, 'broken browser fixture', { mode: 0o755 })
    const result = probe(cache)
    expect(result.available).toBe(true)
    expect(result.chromiumUnavailable).toBe(false)
    expect(result.text).toBeNull()
    expect(result.error).toBeTruthy()
    expect(result.error).not.toContain("Executable doesn't exist")
  })
})
