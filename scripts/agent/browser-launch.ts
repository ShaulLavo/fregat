import type { Browser } from 'playwright'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkoutRoot } from './paths'
import { createScriptError } from '../structured-errors'

// Playwright's --disable-dev-shm-usage makes Chromium keep shared memory as fully allocated files in
// TMPDIR. On a tmpfs /tmp each 2 MiB response buffer of a dev page load counts against the job's
// memory cap; on the checkout's disk the allocation reserves blocks only.
export const browserTempRoot = path.join(checkoutRoot, 'node_modules', '.cache', 'agent-browser')

export const ENGINES = ['chromium', 'firefox', 'webkit'] as const

export type Engine = (typeof ENGINES)[number]

export async function prepareBrowserTemp(root = browserTempRoot) {
  const owned: string[] = []
  const remove = async () => {
    for (const directory of owned.toReversed())
      await rm(directory, { recursive: true, force: true })
  }
  try {
    await mkdir(root, { recursive: true })
    const directory = await mkdtemp(path.join(root, 'run-'))
    owned.push(directory)
    const ipc = await mkdtemp(path.join(tmpdir(), 'b-'))
    owned.push(ipc)
    const temporary = path.join(ipc, 'd')
    // Chromium binds its singleton socket through TMPDIR; the alias keeps the path short.
    // Files still land in the owned data directory, including shared-memory buffers.
    await symlink(directory, temporary, process.platform === 'win32' ? 'junction' : 'dir')
    return { directory, temporary, remove }
  } catch (error) {
    await remove()
    throw error
  }
}

export async function launchBrowser(
  engine: Engine,
  headed: boolean,
  notifications = false,
): Promise<Browser> {
  const cache = '/work/cache/ms-playwright'
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(cache)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = cache
  }
  // Imported here: Playwright fixes its browser directory when it loads, and Bun loads a static
  // import before any code in this file runs.
  const playwright = await import('playwright')
  const { chromium } = playwright
  if (engine !== 'chromium') return playwright[engine].launch({ headless: !headed })
  // Playwright hides scrollbars by default. Users have them, and a scrollbar that appears with
  // content changes every width the app measures.
  const ignoreDefaultArgs = ['--hide-scrollbars']
  const temp = await prepareBrowserTemp()
  const options = {
    headless: !headed,
    ignoreDefaultArgs,
    env: { ...process.env, TMPDIR: temp.temporary },
    downloadsPath: path.join(temp.directory, 'downloads'),
    tracesDir: path.join(temp.directory, 'traces'),
  }
  try {
    // The headless shell denies notification permission; full Chromium in headless mode grants it.
    const context = await chromium.launchPersistentContext(
      path.join(temp.directory, 'profile'),
      notifications ? { ...options, channel: 'chromium' } : options,
    )
    const browser = context.browser()
    if (!browser) {
      await context.close()
      throw createScriptError('The owned browser context has no browser connection.', {
        internal: { engine, headed, notifications },
      })
    }
    browser.on('disconnected', () => void temp.remove())
    const close = browser.close.bind(browser)
    browser.close = async (options) => {
      try {
        await close(options)
      } finally {
        // Profile writers can finish after the disconnected event.
        await temp.remove()
      }
    }
    return browser
  } catch (error) {
    await temp.remove()
    throw error
  }
}
