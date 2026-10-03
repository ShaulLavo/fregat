import { ok } from 'node:assert/strict'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
  waitForFileContent,
} from '../fixture-workspace'
import { checkoutRoot } from '../paths'
import { focusEditor, openFileFromTree, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

export const verifyClientUpdate: Scenario['run'] = async (page, { step, server }) => {
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
      await Promise.all([
        page.waitForResponse((response) => response.url().endsWith('/release')),
        selectors.clientUpdateReload(page).click(),
      ])
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
