import { equal, ok } from 'node:assert/strict'
import type { Page } from 'playwright'

import { committedFixture } from '../fixture-workspace'
import { startIsolatedServer } from '../isolated-server'
import { selectors, waitForApp } from '../selectors'
import { openWiredContextPage } from '../wired-context'
import type { Scenario } from './index'

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true }
/** Nothing listens on the discard port, so a connection there fails at once. */
const UNREACHABLE = 'http://127.0.0.1:9'

/**
 * A fresh install with no folder open: the empty chat with the first-workspace choice over it,
 * on a desktop and on a phone. The remote path fails against an unreachable address, keeps the
 * draft, then connects a second throwaway server and opens a folder there; the phone takes the
 * local path through the in-app picker. Each path must land in that project's chat.
 */
export const firstWorkspaceMachines: Scenario = {
  name: 'first-workspace-machines',
  description:
    'Fresh install: the choice of this machine or a remote one over the empty chat, on desktop and phone, through connection failure, retry, cancel, and both folder paths.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const fixture = await committedFixture('first-workspace')
    const remote = await startIsolatedServer(new URL(page.url()))
    const desktop = await freshPage(page, {})
    const phone = await freshPage(page, PHONE)
    try {
      await remotePath(desktop.page, step, remote.origin, fixture.path)
      await localPhonePath(phone.page, step, fixture.path)
    } catch (error) {
      // The run's own failure capture shows the first page; these two hold the evidence.
      await step('failure-desktop', desktop.page).catch(() => undefined)
      await step('failure-phone', phone.page).catch(() => undefined)
      throw error
    } finally {
      await desktop.close()
      await phone.close()
      await remote.stop()
      await fixture.release()
    }
  },
}

type Step = Parameters<Scenario['run']>[1]['step']

/** A new browser context with no workspace cache, whose server reports no recent folders. */
async function freshPage(page: Page, options: Parameters<typeof openWiredContextPage>[1]) {
  const wired = await openWiredContextPage(page, options)
  await wired.page.route(
    (url) => url.pathname.endsWith('/fs/recents'),
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      await route.fulfill({ response, json: { entries: [] } })
    },
  )
  const base = new URL(page.url())
  await wired.page.goto(`${base.origin}/`)
  await waitForApp(wired.page)
  return wired
}

async function remotePath(page: Page, step: Step, origin: string, folder: string) {
  await selectors.firstWorkspaceDialog(page).waitFor()
  await step('desktop-first-launch', page)
  await page.keyboard.press('Escape')
  await selectors.firstWorkspaceDialog(page).waitFor({ state: 'hidden' })
  await selectors.firstWorkspaceChat(page).waitFor()
  await step('desktop-dialog-dismissed', page)

  await selectors.firstWorkspaceChatRemote(page).click()
  const dialog = selectors.firstWorkspaceRemote(page)
  await dialog.waitFor()
  await selectors.machineRemoteUrl(page).click()
  await selectors.machineServerUrl(page).fill(UNREACHABLE)
  await selectors.machineConnect(page).click()
  await selectors.machineDialogError(dialog).first().waitFor({ timeout: 30_000 })
  equal(await selectors.machineServerUrl(page).inputValue(), UNREACHABLE)
  await step('desktop-remote-error-keeps-draft', page)

  await selectors.machineServerUrl(page).fill(origin)
  await selectors.machineConnect(page).click()
  await selectors.pickerDialog(page).waitFor({ timeout: 30_000 })
  await step('desktop-remote-picker', page)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ timeout: 10_000 })
  ok(!(await selectors.windowToolbar(page).getByText(leaf(folder)).isVisible()))
  await step('desktop-picker-cancel-keeps-machine', page)

  await dialog
    .getByRole('button', { name: /Connected$/ })
    .first()
    .click()
  await chooseFolder(page, folder)
  await selectors
    .projectMenu(page)
    .and(page.locator(`[title^="${folder.slice(1)}"]`))
    .waitFor({
      timeout: 30_000,
    })
  await page.locator('[data-testid="chat-input-editor"]').first().waitFor({ timeout: 30_000 })
  ok(new URL(page.url()).pathname.includes('/chat'), `Lands in chat: ${page.url()}`)
  await step('desktop-remote-project-chat', page)
}

async function localPhonePath(page: Page, step: Step, folder: string) {
  await selectors.firstWorkspaceDialog(page).waitFor()
  equal(await selectors.windowToolbar(page).count(), 0, 'A phone shows no desktop titlebar')
  await selectors.phoneShell(page).locator('header').waitFor()
  await step('phone-first-launch', page)
  await page.keyboard.press('Escape')
  await selectors.firstWorkspaceChat(page).waitFor()
  await step('phone-empty-chat', page)
  const initialIndex = await page.evaluate(() => window.history.state.__TSR_index)
  await selectors.firstWorkspaceChatLocal(page).click()
  await selectors.pickerDialog(page).waitFor({ timeout: 30_000 })
  await step('phone-local-picker', page)
  await chooseFolder(page, folder)
  await selectors
    .phoneShell(page)
    .locator('[data-testid="chat-input-editor"]')
    .first()
    .waitFor({ timeout: 30_000 })
  equal(await selectors.firstWorkspaceChat(page).count(), 0)
  await step('phone-local-project', page)
  const projectHref = page.url()
  await page.goBack()
  await selectors.phoneShell(page).waitFor({ timeout: 30_000 })
  await step('phone-back-keeps-project', page)
  equal(await selectors.firstWorkspaceChat(page).count(), 0)
  equal(new URL(page.url()).pathname.split('/')[1], new URL(projectHref).pathname.split('/')[1])
  equal(
    await page.evaluate(() => window.history.state.__TSR_index),
    initialIndex,
    'Choosing a project replaces the no-project entry',
  )
}

async function chooseFolder(page: Page, folder: string) {
  const picker = selectors.pickerDialog(page)
  await picker.waitFor({ timeout: 30_000 })
  await picker.getByRole('button', { name: /^Go to folder/ }).click()
  await selectors.pickerFolderPath(page).fill(folder)
  await selectors.pickerFolderPath(page).press('Enter')
  await selectors.pickerFolderPath(page).waitFor({ state: 'hidden' })
  await picker.getByRole('button', { name: 'Open', exact: true }).click()
}

function leaf(folder: string) {
  return folder.split('/').at(-1)!
}
