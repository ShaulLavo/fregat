import { equal, ok } from 'node:assert/strict'
import { readCaches } from '../cache-snapshot'
import { writeUserOperations } from '../preserve-settings'
import { selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

export const settingsShortcutMetadata: Scenario = {
  name: 'settings-shortcut-metadata',
  description:
    'Contain a failed preset report, recover by reloading, edit while metadata loads and copy the complete report.',
  inspect: (page) => page.evaluate(readCaches),
  async run(page, { step }) {
    const route = '**/src/keymap/presets/inventory.ts*'
    let requests = 0
    await page.route(route, (request) => {
      requests += 1
      return request.abort('failed')
    })
    await page.reload()
    await waitForApp(page)
    equal(requests, 0, 'Keyboard startup leaves the rich inventory unloaded')
    await page.keyboard.press('ControlOrMeta+,')
    await selectors.settingsSearch(page).fill('keyboard')
    await selectors.shortcutsList(page).waitFor()
    await selectors.shortcutMetadataError(page).waitFor()
    await selectors.shortcutsSearch(page).fill('workspace.saveFile')
    await selectors.shortcutPresetRow(page, 'workspace.saveFile').waitFor()
    await selectors.shortcutActions(page).click()
    ok(await selectors.shortcutReportCopy(page).isDisabled(), 'Export waits for its report data')
    await page.keyboard.press('Escape')
    await selectors.shortcutMetadataError(page).scrollIntoViewIfNeeded()
    await step('report-failure-with-live-shortcuts')
    await page.unroute(route)

    const gate = Promise.withResolvers<void>()
    await page.route(route, async (request) => {
      await gate.promise
      await request.continue()
    })
    try {
      await selectors.shortcutMetadataReload(page).click()
      await selectors.settingsSearch(page).fill('keyboard')
      await selectors.shortcutMetadataLoading(page).waitFor()
      await selectors.shortcutsSearch(page).fill('workspace.saveFile')
      await selectors.shortcutPresetRow(page, 'workspace.saveFile').dblclick()
      await selectors.shortcutRecorder(page, 'Save').press('ControlOrMeta+Alt+J')
      await selectors.shortcutSave(page).click()
      await selectors.shortcutRow(page, 'workspace.saveFile', 'Mod+Alt+J').waitFor()
      await step('live-edit-during-report-load')
      gate.resolve()
      await selectors.shortcutUnmapped(page).waitFor()
      await selectors.shortcutActions(page).click()
      ok(await selectors.shortcutReportCopy(page).isEnabled(), 'Complete export is available')
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await selectors.shortcutReportCopy(page).click()
      const report = await page.evaluate(() => navigator.clipboard.readText())
      ok(
        report.includes('Shortcut resolution') && report.includes('Unmapped preset actions'),
        'Copied report includes runtime resolution and inventory',
      )
      ok(
        report.includes('The key is unavailable in this client.'),
        'Unsupported keys stay in the report',
      )
      const resources = (await page.evaluate(readCaches)).find(
        (client) => client.scope === 'resources',
      )
      ok(
        resources?.queries.some(
          (query) => query.key === '["settings","shortcut-metadata"]' && query.status === 'success',
        ),
        'Metadata query settled',
      )
      ok(
        resources?.mutations.some(
          (mutation) =>
            mutation.key === '["settings","shortcut-metadata","load"]' &&
            mutation.status === 'success',
        ),
        'Import mutation settled',
      )
      await selectors.shortcutUnmapped(page).click()
      await selectors.shortcutUnmapped(page).scrollIntoViewIfNeeded()
      await step('complete-report-and-settled-cache')
    } finally {
      gate.resolve()
      await page.unroute(route)
      await writeUserOperations(page, [{ kind: 'reset', keys: ['keybindings.overrides'] }])
    }
  },
}
