import { scratchPath } from '../paths'
import { deepEqual, ok, strictEqual } from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { selectors, captureFilePreviewFrame, filePreviewFrameFacts, waitForApp } from '../selectors'
import { releaseFixture } from '../fixture-workspace'
import { captureScenarioFailure } from '../scenario-failure'
import type { Scenario } from './index'
import type { JSHandle } from 'playwright'
import type { FilePreviewFrame } from '../selectors'

export const filePickerSelection: Scenario = {
  name: 'file-picker-selection',
  description: 'Leave an empty column, select its sibling, then hide a selected hidden folder.',
  async run(page, { step }) {
    const root = await mkdtemp(scratchPath('fregat-picker-selection-'))
    await Promise.all(
      ['empty-review-folder', 'sibling-review-folder/child', '.hidden'].map((folder) =>
        mkdir(path.join(root, folder), { recursive: true }),
      ),
    )
    try {
      await selectors.projectMenu(page).click()
      await selectors.openFolderMenu(page).click()
      await selectors.pickerGoToFolder(page).click()
      await selectors.pickerFolderPath(page).fill(root)
      await page.keyboard.press('Enter')
      await selectors.pickerRow(page, 'empty-review-folder').click()
      await page.keyboard.press('ArrowRight')
      await selectors.pickerColumn(page, 1).focus()
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowDown')
      await selectors.pickerColumn(page, 1).getByText('child', { exact: true }).waitFor()
      await selectors
        .pickerPreviewPath(page, path.join(root, 'sibling-review-folder').slice(1))
        .waitFor()
      await step('sibling-after-empty-column')
      const siblingSelection = await selectors.pickerPreview(page).getAttribute('data-file-preview')

      const show = selectors.pickerHiddenToggle(page, false)
      if (await show.isVisible()) await show.click()
      await selectors.pickerRow(page, '.hidden').click()
      await selectors.pickerColumn(page, 1).waitFor()
      await selectors.pickerHiddenToggle(page, true).click()
      await selectors.pickerRow(page, '.hidden').waitFor({ state: 'hidden' })
      await selectors.pickerPreviewPath(page, root.slice(1)).waitFor()
      await step('hidden-selection-cleared')
      const hiddenSelection = await selectors.pickerPreview(page).getAttribute('data-file-preview')
      await page.keyboard.press('Escape')
      deepEqual(
        { siblingSelection, hiddenSelection },
        {
          siblingSelection: path.join(root, 'sibling-review-folder').slice(1),
          hiddenSelection: root.slice(1),
        },
      )
    } finally {
      await releaseFixture(root)
    }
  },
}

export async function pickerLivePreview(
  page: Parameters<Scenario['run']>[0],
  { step, evidence }: Parameters<Scenario['run']>[1],
  fixture: string,
  filename: string,
) {
  await page.keyboard.press('Control+o')
  await selectors.pickerGoToFolder(page).click()
  await selectors.pickerFolderPath(page).fill(fixture)
  await page.keyboard.press('Enter')
  await selectors.pickerRow(page, filename).click()
  await selectors.pickerPreviewText(page).waitFor()
  const frame = await selectors.pickerPreviewText(page).evaluateHandle(captureFilePreviewFrame)
  const facts = await frame.evaluate(filePreviewFrameFacts)
  ok(facts, 'Picker captured the actual source owner/read')
  strictEqual(facts.kind, 'live')
  strictEqual(facts.interestCount, 1)
  strictEqual(facts.name, filename)
  strictEqual(facts.nativeBufferMatches, true)
  strictEqual(facts.dirty, true)
  strictEqual(facts.complete, false)
  ok(facts.prefix?.startsWith('DIRTY_A '))
  const shownFacts = await selectors.pickerPreviewFacts(page).textContent()
  ok(shownFacts?.includes('Unsaved buffer'))
  ok(shownFacts?.includes('Disk modified'))
  strictEqual(
    await selectors.pickerPreviewFacts(page).getByText('Size', { exact: true }).count(),
    0,
  )
  await evidence.json('picker-live-read-and-facts.json', { facts, shownFacts })
  await step('picker-shows-current-dirty-prefix-and-disk-facts')
  return frame
}

export async function rootlessPickerPreview(
  page: Parameters<Scenario['run']>[0],
  { step, evidence, server }: Parameters<Scenario['run']>[1],
  fixture: string,
  filename: string,
) {
  const browser = page.context().browser()
  ok(browser && server, 'A fixture-only browser/API pair is required')
  const context = await browser.newContext({ viewport: page.viewportSize() })
  await context.addInitScript(`window.platformDevServerUrl = ${JSON.stringify(server.origin)}`)
  const fresh = await context.newPage()
  const requests: { route: string; target: string }[] = []
  const request = (item: import('playwright').Request) => {
    const url = new URL(item.url())
    const target = url.searchParams.get('path')
    if (
      target === path.join(fixture, filename).slice(1) &&
      (url.pathname.endsWith('/fs/head') || url.pathname.endsWith('/fs/read'))
    )
      requests.push({ route: url.pathname, target })
  }
  fresh.on('request', request)
  let frame: JSHandle<FilePreviewFrame | null> | null = null
  try {
    await fresh.goto(new URL('/', page.url()).href)
    await waitForApp(fresh)
    await fresh.keyboard.press('Control+o')
    await selectors.pickerGoToFolder(fresh).click()
    await selectors.pickerFolderPath(fresh).fill(fixture)
    await fresh.keyboard.press('Enter')
    await selectors.pickerRow(fresh, filename).click()
    await selectors.pickerPreviewText(fresh).waitFor()
    const captured = await selectors
      .pickerPreviewText(fresh)
      .evaluateHandle(captureFilePreviewFrame)
    frame = captured
    const facts = await captured.evaluate(filePreviewFrameFacts)
    ok(facts)
    strictEqual(facts.scope, null)
    strictEqual(facts.kind, 'disk')
    strictEqual(facts.interestCount, 0)
    strictEqual(facts.leasePresent, false)
    strictEqual(facts.projectionHasNativeInput, false)
    ok(facts.prefix?.startsWith('DISK_B'))
    strictEqual(requests.filter((item) => item.route.endsWith('/fs/head')).length, 1)
    strictEqual(requests.filter((item) => item.route.endsWith('/fs/read')).length, 0)
    await evidence.json('rootless-query-owned-picker.json', { facts, requests })
    await step('rootless-picker-holds-query-reader-with-zero-leases', fresh)
    await fresh.keyboard.press('Escape')
    strictEqual((await captured.evaluate(filePreviewFrameFacts))?.interestCount, 0)
  } catch (error) {
    await captureScenarioFailure(fresh, evidence, 'before-cleanup')
    throw error
  } finally {
    fresh.off('request', request)
    await frame?.dispose()
    await context.close()
  }
}
