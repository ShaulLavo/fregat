import { equal, ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import { readSetting, writeUserOperations } from '../preserve-settings'
import { selectors } from '../selectors'
import type { Scenario } from './index'

async function override(page: Page, command: string) {
  const overrides = await readSetting(page, 'keybindings.overrides')
  ok(overrides && typeof overrides === 'object')

  return (overrides as Record<string, unknown>)[command]
}

async function waitForOverride(page: Page, command: string, expected: unknown) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await override(page, command)) === expected) return
    await page.waitForTimeout(100)
  }
  equal(await override(page, command), expected, `${command} override`)
}

async function waitForList(page: Page, command: string, expected: readonly string[]) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (JSON.stringify(await override(page, command)) === JSON.stringify(expected)) return
    await page.waitForTimeout(100)
  }
  equal(JSON.stringify(await override(page, command)), JSON.stringify(expected), `${command} list`)
}

async function showOnly(page: Page, query: string) {
  await selectors.shortcutsSearch(page).fill(query)
}

export const settingsKeybindings: Scenario = {
  name: 'settings-keybindings',
  description:
    'The shortcuts editor at 1440 and 390: search, filters, Record keys, recording with a conflict shown before saving, the row menu, and settings.json after each write. Writes only the throwaway server.',
  async run(page, { step }) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('keyboard')
    await selectors.shortcutsList(page).waitFor()
    ok(
      (await selectors.shortcutsList(page).locator('[data-slot="virtual-list"]').count()) === 0,
      'The list flows in the page scroller',
    )
    await step('desktop-list')

    await showOnly(page, 'Go to line')
    await selectors.shortcutRow(page, 'workspace.goToLine').dblclick()
    await selectors.shortcutRecorder(page, 'Go to line').press('Control+Alt+K')
    await step('desktop-recording')
    equal(await override(page, 'workspace.goToLine'), undefined, 'Nothing is written before Enter')
    await selectors.shortcutRecorder(page, 'Go to line').press('Enter')
    await waitForList(page, 'workspace.goToLine', ['Mod+Alt+K'])

    await showOnly(page, 'Save')
    await selectors.shortcutRow(page, 'workspace.saveFile').dblclick()
    await selectors.shortcutRecorder(page, 'Save').press('Control+Alt+K')
    await page.getByText('Used by 1 command', { exact: true }).waitFor()
    await step('desktop-conflict-before-save')
    await selectors.shortcutRecorder(page, 'Save').press('Escape')
    await selectors.shortcutRecorder(page, 'Save').press('Escape')
    equal(
      await override(page, 'workspace.saveFile'),
      undefined,
      'A cancelled recording writes nothing',
    )

    await selectors.shortcutsSearch(page).fill('')
    await selectors.shortcutRecordKeys(page).click()
    await selectors.shortcutsSearch(page).press('Control+Alt+K')
    await selectors.shortcutRow(page, 'workspace.goToLine').waitFor()
    equal(
      await selectors.shortcutsList(page).getByRole('option').count(),
      1,
      'Record keys finds one row',
    )
    await step('desktop-record-keys-search')
    await selectors.shortcutRecordKeys(page).click()

    await selectors.shortcutFilter(page, 'Custom').click()
    await selectors.shortcutRow(page, 'workspace.goToLine').waitFor()
    await step('desktop-custom-filter')
    await selectors.shortcutRow(page, 'workspace.goToLine').click({ button: 'right' })
    await selectors.shortcutMenuItem(page, /^Reset to default/).click()
    await waitForOverride(page, 'workspace.goToLine', undefined)
    await selectors.shortcutFilter(page, 'All').click()

    // Several shortcuts per command: add F7 beside the palette's defaults, run it by both, remove it.
    await showOnly(page, 'Show command palette')
    await selectors
      .shortcutRow(page, 'workspace.showCommandPalette', 'F1')
      .click({ button: 'right' })
    await selectors.shortcutMenuItem(page, /^Add another shortcut/).click()
    await selectors.shortcutRecorder(page, 'Show command palette').press('F7')
    await selectors.shortcutRecorder(page, 'Show command palette').press('Enter')
    await waitForList(page, 'workspace.showCommandPalette', ['Mod+Shift+P', 'F1', 'F7'])
    await selectors.shortcutRow(page, 'workspace.showCommandPalette', 'F7').waitFor()
    await step('desktop-second-shortcut')
    for (const chord of ['F7', 'F1']) {
      // Bare F-keys go to a focused text field, and Escape hands focus back to the page search.
      await selectors.shortcutsList(page).focus()
      await page.keyboard.press(chord)
      await selectors.paletteInput(page).waitFor()
      await page.keyboard.press('Escape')
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
    }
    await selectors
      .shortcutRow(page, 'workspace.showCommandPalette', 'F7')
      .click({ button: 'right' })
    await selectors.shortcutMenuItem(page, /^Remove shortcut/).click()
    await waitForList(page, 'workspace.showCommandPalette', ['Mod+Shift+P', 'F1'])

    // A phone opens Settings as the full-screen dialog of a fresh window.
    await page.addInitScript(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    const home = new URL(page.url())
    home.pathname = `${home.pathname.split('/~')[0]}/`
    home.search = ''
    home.hash = ''
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(home.href, { waitUntil: 'domcontentloaded' })
    await selectors.chooseFolder(page).waitFor()
    await page.keyboard.press('Control+,')
    await selectors.settingsDialog(page).waitFor()
    // Settings search finds the command and brings the shortcut list with it.
    await selectors.settingsSearch(page).fill('Save')
    await selectors.shortcutsList(page).waitFor()
    await showOnly(page, 'Save')
    const saveRow = selectors.shortcutRow(page, 'workspace.saveFile')
    await saveRow.waitFor()
    const height = (await saveRow.boundingBox())?.height ?? 0
    ok(height >= 40, `A narrow row is a touch target (${height}px)`)
    await step('narrow-list')
    await saveRow.click()
    await selectors.shortcutMenuItem(page, /^Remove shortcut/).waitFor()
    await step('narrow-row-menu')
    await selectors.shortcutMenuItem(page, /^Remove shortcut/).click()
    await waitForList(page, 'workspace.saveFile', [])
    await step('narrow-removed')

    await writeUserOperations(page, [{ kind: 'reset', keys: ['keybindings.overrides'] }])
  },
}
