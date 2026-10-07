import { ok } from 'node:assert/strict'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CDPSession, Page } from 'playwright'
import {
  createGitFixture,
  createModifiedFileFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
  waitForFileContent,
} from '../fixture-workspace'
import { checkoutRoot } from '../paths'
import { focusEditor, openFileFromTree, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'
import type { Evidence } from '../evidence'
import { openFixtureChat } from './phone-fixture'

export const phoneUpdateReload: Scenario = {
  name: 'phone-update-reload',
  requiresIsolatedServer: true,
  description:
    'Hold the reload document response and verify progress, repeat taps and stable Settings position on a touch phone.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  async run(page, context) {
    const fixture = await createModifiedFileFixture(
      'phone-update-reload',
      'notes.md',
      ['one'],
      ['two'],
    )
    try {
      await openFixtureChat(page, fixture)
      await verifyClientUpdate(page, context)
    } finally {
      await releaseFixture(fixture)
    }
  },
}

export const verifyClientUpdate: Scenario['run'] = async (page, { step, server, evidence }) => {
  ok(server, 'This scenario uses the isolated server release files')
  await unlink(join(server.productionRoot, 'pending')).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
  server.signal('SIGUSR2')
  const config = join(server.directory, 'served', 'build-config.json')
  await writeFile(config, JSON.stringify({ release: 'client-1' }))
  await page.evaluate(() => sessionStorage.removeItem('scenario-client-release'))
  // Vite's document needs the release identity that deployment stamps into built HTML.
  await page.addInitScript(() => {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        const meta = document.createElement('meta')
        meta.name = 'platform-release'
        meta.content = sessionStorage.getItem('scenario-client-release') ?? 'client-1'
        document.head.append(meta)
      },
      { once: true },
    )
  })
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/release')),
    page.reload(),
  ])
  await page.waitForTimeout(500)
  ok((await selectors.clientUpdateReload(page).count()) === 0, 'Matching client stays quiet')
  await step('current-client')

  const fixture =
    (page.viewportSize()?.width ?? 1440) >= 600 ? await createGitFixture('update-unsaved') : null
  try {
    if (fixture) {
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'a.txt')
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await page.keyboard.type('saved ')
    }
    const started = await page.evaluate(() => performance.timeOrigin)
    await writeFile(config, JSON.stringify({ release: 'client-2' }))
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
    )
    await selectors.clientUpdateReload(page).waitFor({ timeout: 15_000 })
    ok(
      (await page.evaluate(() => performance.timeOrigin)) === started,
      'A page-only update waits for a click',
    )
    ok(
      (await selectors.toast(page, 'Update available').count()) === 0,
      'The titlebar owns the update control',
    )
    await step('reload-available')
    await page.evaluate(() => sessionStorage.setItem('scenario-client-release', 'client-2'))

    if (fixture) {
      await selectors.clientUpdateReload(page).click()
      await selectors.updatePopover(page).waitFor()
      ok(
        (await selectors.updatePopover(page).innerText()).includes('a.txt'),
        'The popover names the unsaved file',
      )
      await step('unsaved-file-confirmation')
      await selectors.updateNow(page).click()
      await selectors.updatePopover(page).waitFor({ state: 'hidden' })
      await page.waitForTimeout(300)
      ok(
        (await page.evaluate(() => performance.timeOrigin)) === started,
        'Update now preserves the unsaved editor buffer',
      )
      await step('reload-waits-for-save')
      await focusEditor(page)
      await page.keyboard.press('Control+s')
      await waitForFileContent(join(fixture, 'a.txt'), 'saved one\n')
      await page.waitForFunction((before) => performance.timeOrigin !== before, started)
    } else {
      await reloadPhone(page, evidence)
    }
    await waitForApp(page)
    if (fixture) await selectors.editorInput(page).first().waitFor({ timeout: 15_000 })
    ok(
      (await page.evaluate(() => performance.timeOrigin)) !== started,
      'The document reloads after consent and save',
    )
    ok(
      (await selectors.clientUpdateReload(page).count()) === 0,
      'The updated client clears the control',
    )
    await step('reloaded')
  } finally {
    if (fixture) {
      try {
        await openFixtureWorkspace(page, checkoutRoot)
        // Recreate the runtime so retained fixture readers stop before its files are removed.
        await page.reload()
        await waitForApp(page)
      } finally {
        await releaseFixture(fixture)
      }
    }
  }
}

async function reloadPhone(page: Page, evidence: Evidence) {
  const settings = selectors.phoneHeaderAction(page, 'Settings')
  const before = await settings.boundingBox()
  const button = await selectors.clientUpdateReload(page).boundingBox()
  ok(before && button, 'Settings and Reload app must be visible')
  const point = { x: button.x + button.width - 6, y: button.y + button.height / 2 }
  const released = Promise.withResolvers<void>()
  const continued = Promise.withResolvers<void>()
  let documentRequested = false
  let capture: CDPSession | null = null
  const href = page.url()
  await page.evaluate(
    ({ progress, button }) => {
      window.addEventListener(
        'beforeunload',
        () => {
          sessionStorage.setItem(
            'scenario-reload-feedback',
            JSON.stringify({
              busy: document.querySelector(button)?.getAttribute('aria-busy') === 'true',
              progress: document.querySelector(progress) !== null,
            }),
          )
        },
        { once: true },
      )
    },
    {
      progress: selectors.serverReloadProgressSelector,
      button: selectors.serverUpdateButtonSelector,
    },
  )
  await page.route(href, async (route) => {
    documentRequested = true
    await released.promise
    try {
      await route.continue()
    } finally {
      continued.resolve()
    }
  })
  try {
    const documentRequest = page.waitForRequest(
      (request) => request.isNavigationRequest() && request.url() === href,
    )
    await selectors.clientUpdateReload(page).click({ noWaitAfter: true })
    await documentRequest
    capture = await capturePendingReload(page, evidence)
  } finally {
    released.resolve()
    if (documentRequested) await continued.promise
    await page.unroute(href)
    await capture?.detach()
  }
  await waitForApp(page)
  await selectors.phoneLevel(page, 'sessions').waitFor()
  const feedback = await page.evaluate<{ busy: boolean; progress: boolean } | null>(
    `JSON.parse(sessionStorage.getItem('scenario-reload-feedback') || 'null')`,
  )
  await evidence.json('pending-document.json', feedback)
  ok(
    feedback?.busy && feedback.progress,
    'Reload must show disabled busy feedback before browser navigation starts',
  )
  const after = await settings.boundingBox()
  ok(
    after && Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1,
    'Settings must keep its position when the reload control disappears',
  )
  await page.mouse.click(point.x, point.y)
  ok(
    await selectors.phoneLevel(page, 'sessions').isVisible(),
    'A repeat tap at the old reload position must leave the session list open',
  )
}

async function capturePendingReload(page: Page, evidence: Evidence) {
  if (page.context().browser()?.browserType().name() !== 'chromium') return null
  // Playwright screenshots wait for navigation; CDP captures the old document while its response waits.
  const cdp = await page.context().newCDPSession(page)
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await evidence.write('pending-document.png', Buffer.from(screenshot.data, 'base64'))
  return cdp
}
