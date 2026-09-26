import { ok, strictEqual } from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { writeUserSetting } from '../preserve-settings'
import { selectors } from '../selectors'
import type { Scenario } from './index'

const LOWERED_LIMIT = 40
const DEFAULT_LIMIT = 200_000

/** `big/` holds `directories` nested folders, an unreadable `locked/` and a top-level file. */
async function largeFolderFixture(slug: string, directories: number) {
  const root = await mkdtemp(`/work/tmp/fregat-${slug}-`)
  const big = path.join(root, 'big')
  const locked = path.join(big, 'locked')
  await mkdir(path.join(locked, 'inner'), { recursive: true })
  for (let index = 0; index < directories; index += 1)
    await mkdir(path.join(big, 'nested', `d${index}`), { recursive: true })
  await writeFile(path.join(big, 'top.txt'), 'top\n')
  await chmod(locked, 0o000)
  return {
    root,
    big,
    release: async () => {
      await chmod(locked, 0o755)
      await releaseFixture(root)
    },
  }
}

async function pickFolder(page: Page, parent: string, name: string) {
  await selectors.projectMenu(page).click()
  await selectors.openFolderMenu(page).click()
  await selectors.pickerDialog(page).waitFor()
  await selectors.pickerGoToFolder(page).click()
  await selectors.pickerFolderPath(page).fill(parent)
  await selectors.pickerFolderPath(page).press('Enter')
  await selectors.pickerFolderPath(page).waitFor({ state: 'hidden' })
  await selectors.pickerOptions(page).filter({ hasText: name }).first().click()
  await selectors.pickerChoose(page).click()
}

function waitForWorkspace(page: Page, folder: string) {
  return selectors
    .projectSwitcher(page)
    .and(page.locator(`[title^="${folder.slice(1)}"]`))
    .waitFor({ timeout: 20_000 })
}

async function expectNoAccess(page: Page) {
  await selectors.treeItem(page, 'locked').click()
  await selectors
    .treeItemDecoration(page, 'locked')
    .filter({ hasText: 'no access' })
    .waitFor({ timeout: 10_000 })
}

async function expectTopLevelLive(page: Page, folder: string) {
  await writeFile(path.join(folder, 'arrived.txt'), 'arrived\n')
  await selectors.treeItem(page, 'arrived.txt').waitFor({ timeout: 10_000 })
}

export const workspaceOpenLargeRoot: Scenario = {
  name: 'workspace-open-large-root',
  description:
    'A folder over the watch limit opens through the picker with limited live updates, an unreadable child reads "no access", and nothing toasts.',
  async run(page, { step }) {
    const fixture = await largeFolderFixture('large-root', LOWERED_LIMIT + 20)
    try {
      await selectors.folderTree(page).waitFor()
      await writeUserSetting(page, 'files.watchDirectoryLimit', LOWERED_LIMIT)
      await pickFolder(page, fixture.root, 'big')
      await waitForWorkspace(page, fixture.big)
      await selectors.liveUpdatesLimited(page).waitFor({ timeout: 10_000 })
      await step('opened-limited')
      await selectors.liveUpdatesLimited(page).hover()
      await page.getByText('Live updates limited:', { exact: false }).waitFor()
      await step('limited-tooltip')
      await page.mouse.move(900, 400)
      await page.getByText('Live updates limited:', { exact: false }).waitFor({ state: 'hidden' })
      await expectNoAccess(page)
      await step('no-access')
      await expectTopLevelLive(page, fixture.big)
      await step('top-level-live')
      strictEqual(await page.locator('[data-sonner-toast]').count(), 0, 'Opening must not toast')
    } finally {
      await writeUserSetting(page, 'files.watchDirectoryLimit', DEFAULT_LIMIT)
      await fixture.release()
    }
  },
}

export const workspaceOpenUnreadableChild: Scenario = {
  name: 'workspace-open-unreadable-child',
  description:
    'A folder under the watch limit with an unreadable child watches everything else, reads "no access" there, and nothing toasts.',
  async run(page, { step }) {
    const fixture = await largeFolderFixture('unreadable-child', 5)
    try {
      await selectors.folderTree(page).waitFor()
      await pickFolder(page, fixture.root, 'big')
      await waitForWorkspace(page, fixture.big)
      await selectors.treeItem(page, 'top.txt').waitFor()
      await step('opened')
      await expectNoAccess(page)
      await step('no-access')
      await expectTopLevelLive(page, fixture.big)
      strictEqual(await selectors.liveUpdatesLimited(page).count(), 0, 'The folder fits the limit')
      strictEqual(await page.locator('[data-sonner-toast]').count(), 0, 'Opening must not toast')
      await step('live')
    } finally {
      await fixture.release()
    }
  },
}

export const workspaceSwitchClickDuringOpen: Scenario = {
  name: 'workspace-switch-click-during-open',
  description:
    'While a picked folder is still opening, a click in the old workspace leaves the switch running and the status names the folder.',
  async run(page, { step }) {
    const first = await mkdtemp('/work/tmp/fregat-switch-first-')
    const second = await mkdtemp('/work/tmp/fregat-switch-second-')
    try {
      await writeFile(path.join(first, 'a.ts'), 'export const a = 1\n')
      await writeFile(path.join(first, 'b.ts'), 'export const b = 2\n')
      await mkdir(path.join(second, 'target'))
      await writeFile(path.join(second, 'target', 'c.ts'), 'export const c = 3\n')
      await openFixtureWorkspace(page, first)
      await selectors.treeItem(page, 'a.ts').waitFor()
      await page.route('**/fs/workspace-root', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000))
        await route.continue()
      })
      await pickFolder(page, second, 'target')
      await selectors.navigationTarget(page).filter({ hasText: 'Opening target' }).waitFor()
      await step('opening-status')
      await selectors.treeItem(page, 'b.ts').click()
      await waitForWorkspace(page, path.join(second, 'target'))
      await selectors.treeItem(page, 'c.ts').waitFor({ timeout: 10_000 })
      await step('switched')
      ok(
        (await selectors.navigationTarget(page).count()) === 0,
        'The opening status clears once the folder lands',
      )
    } finally {
      await page.unroute('**/fs/workspace-root')
      await releaseFixture(first)
      await releaseFixture(second)
    }
  },
}

export const filePickerPrefetchBound: Scenario = {
  name: 'file-picker-prefetch-bound',
  description:
    'Moving the pointer down and scrolling a 600-folder list in the picker lists only folders the pointer settles near.',
  async run(page, { step }) {
    const root = await mkdtemp('/work/tmp/fregat-picker-prefetch-')
    const many = path.join(root, 'many')
    for (let index = 0; index < 600; index += 1)
      await mkdir(path.join(many, `f${String(index).padStart(3, '0')}`), { recursive: true })
    const treeRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/fs/tree') && request.url().includes('many%2Ff'))
        treeRequests.push(request.url())
    })
    try {
      await selectors.folderTree(page).waitFor()
      await selectors.projectMenu(page).click()
      await selectors.openFolderMenu(page).click()
      await selectors.pickerDialog(page).waitFor()
      await selectors.pickerGoToFolder(page).click()
      await selectors.pickerFolderPath(page).fill(many)
      await selectors.pickerFolderPath(page).press('Enter')
      await selectors.pickerFolderPath(page).waitFor({ state: 'hidden' })
      await selectors.pickerOptions(page).first().waitFor()
      await step('listed')
      const list = await selectors.pickerList(page).boundingBox()
      ok(list, 'The list must be laid out')
      await page.mouse.move(list.x + 40, list.y + 10)
      await page.mouse.move(list.x + 40, list.y + list.height - 10, { steps: 30 })
      await page.waitForTimeout(500)
      const swept = treeRequests.length
      await step(`after-sweep-${swept}-listings`)
      for (let turn = 0; turn < 12; turn += 1) {
        await page.mouse.wheel(0, 400)
        await page.waitForTimeout(60)
      }
      await page.waitForTimeout(500)
      const scrolled = treeRequests.length - swept
      await step(`after-scroll-${scrolled}-listings`)
      // A scroll under a still pointer is no intent; 12 turns pass about 200 rows.
      ok(scrolled <= 4, `Scrolling listed ${scrolled} folders the pointer never moved toward`)
      await page.keyboard.press('Escape')
      await selectors.pickerDialog(page).waitFor({ state: 'hidden' })
      // The intent log is written on close and reaches the server with the next client batch.
      await page.waitForTimeout(6000)
      console.log(
        `file-picker-prefetch-bound: ${swept} listings from the sweep, ${scrolled} from scrolling`,
      )
    } finally {
      await releaseFixture(root)
    }
  },
}
