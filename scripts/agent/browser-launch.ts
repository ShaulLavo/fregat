import type { Browser } from 'playwright'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { checkoutRoot } from './paths'

// Playwright's --disable-dev-shm-usage makes Chromium keep shared memory as fully allocated files in
// TMPDIR. On a tmpfs /tmp each 2 MiB response buffer of a dev page load counts against the job's
// memory cap; on the checkout's disk the allocation reserves blocks only.
export const browserTempRoot = path.join(checkoutRoot, 'node_modules', '.cache', 'agent-browser')

export const ENGINES = ['chromium', 'firefox', 'webkit'] as const

export type Engine = (typeof ENGINES)[number]

async function loadPlaywright() {
  const cache = '/work/cache/ms-playwright'
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(cache)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = cache
  }
  // Imported here: Playwright fixes its browser directory when it loads, and Bun loads a static
  // import before any code in this file runs.
  return import('playwright')
}

export async function browserAvailable(
  engine: Engine,
  headed = false,
  notifications = false,
): Promise<boolean> {
  const playwright = await loadPlaywright()
  if (engine !== 'chromium' || headed || notifications)
    return existsSync(playwright[engine].executablePath())
  // executablePath() exposes full Chromium; the pinned launch registry resolves its headless shell.
  const core = createRequire(import.meta.resolve('playwright'))(
    'playwright-core/lib/coreBundle',
  ) as {
    registry: { registry: { findExecutable(name: string): { executablePath(): string } } }
  }
  return existsSync(
    core.registry.registry.findExecutable('chromium-headless-shell').executablePath(),
  )
}

export async function launchBrowser(
  engine: Engine,
  headed: boolean,
  notifications = false,
): Promise<Browser> {
  const playwright = await loadPlaywright()
  const { chromium } = playwright
  if (engine !== 'chromium') return playwright[engine].launch({ headless: !headed })
  // Playwright hides scrollbars by default. Users have them, and a scrollbar that appears with
  // content changes every width the app measures.
  const ignoreDefaultArgs = ['--hide-scrollbars']
  await mkdir(browserTempRoot, { recursive: true })
  const temp = await mkdtemp(path.join(browserTempRoot, 'run-'))
  const removeTemp = () => rm(temp, { recursive: true, force: true })
  const options = { headless: !headed, ignoreDefaultArgs, env: { ...process.env, TMPDIR: temp } }
  try {
    // The headless shell denies notification permission; full Chromium in headless mode grants it.
    const browser = await chromium.launch(
      notifications ? { ...options, channel: 'chromium' } : options,
    )
    browser.on('disconnected', () => void removeTemp())
    return browser
  } catch (error) {
    await removeTemp()
    throw error
  }
}
