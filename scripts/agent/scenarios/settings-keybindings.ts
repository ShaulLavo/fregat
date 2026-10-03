import { readCaches } from '../cache-snapshot'
import { deepEqual, equal, ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import * as v from 'valibot'
import {
  keybindingOverridesSchema,
  type KeybindingOverrides,
} from '../../../packages/contracts/src/settings'
import { readSetting, writeUserOperations } from '../preserve-settings'
import { selectors } from '../selectors'
import type { Scenario } from './index'

async function overrides(page: Page): Promise<KeybindingOverrides> {
  return v.parse(
    keybindingOverridesSchema,
    (await readSetting(page, 'keybindings.overrides')) ?? [],
  )
}

async function waitForBindings(page: Page, expected: KeybindingOverrides) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (JSON.stringify(await overrides(page)) === JSON.stringify(expected)) return
    await page.waitForTimeout(100)
  }
  deepEqual(await overrides(page), expected, 'Authored contextual bindings')
}

const COMMAND = 'workspace.saveFile'
const CONTEXT = 'Terminal && mode == alternate'

export const settingsKeybindings: Scenario = {
  name: 'settings-keybindings',
  description:
    'Contextual recording, preset clear/reset, reservations and targeted unbinds, with desktop and phone evidence from isolated settings.',
  inspect: (page) => page.evaluate(readCaches),
  async run(page, { step }) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.keyboard.press('ControlOrMeta+,')
    await selectors.settingsSearch(page).fill('keyboard')
    await selectors.shortcutsList(page).waitFor()
    const titles = await selectors.shortcutPresetTabs(page).getByRole('tab').allTextContents()
    deepEqual(titles, ['Ours', 'Zed', 'VS Code'])
    await step('desktop-presets')

    await writeUserOperations(page, [
      { kind: 'keybinding.set', command: COMMAND, keys: ['F6'], context: 'Workspace' },
    ])
    await selectors.shortcutsSearch(page).fill(COMMAND)
    await selectors.shortcutRow(page, COMMAND, 'F6', 'Workspace').dblclick()
    await selectors.shortcutContext(page).fill('Editor &&')
    await selectors.shortcutRecorder(page, 'Save').press('ControlOrMeta+Alt+J')
    ok(await selectors.shortcutSave(page).isDisabled(), 'Invalid predicate disables Save')
    await selectors.shortcutContext(page).fill(CONTEXT)
    await waitForBindings(page, [{ keys: 'F6', command: COMMAND, context: 'Workspace' }])
    await step('desktop-context-before-save')
    await selectors.shortcutRecorder(page, 'Save').press('Enter')
    await waitForBindings(page, [
      { keys: 'F6', command: COMMAND, context: 'Workspace' },
      { keys: 'Mod+Alt+J', command: COMMAND, context: CONTEXT },
    ])
    const contextual = selectors.shortcutRow(page, COMMAND, 'Mod+Alt+J', CONTEXT)
    await contextual.waitFor()
    ok((await contextual.getAttribute('title'))?.includes(CONTEXT), 'Full predicate is recoverable')
    await step('desktop-context-saved')
    await contextual.click({ button: 'right' })
    await selectors.shortcutMenuItem(page, /^Reset to default/).click()
    await waitForBindings(page, [{ keys: 'F6', command: COMMAND, context: 'Workspace' }])
    await step('desktop-exact-context-reset')
    await writeUserOperations(page, [{ kind: 'reset', keys: ['keybindings.overrides'] }])

    const preset = selectors.shortcutPresetRow(page, COMMAND)
    await preset.waitFor()
    const keys = await preset.getAttribute('data-shortcut-keys')
    const context = await preset.getAttribute('data-shortcut-context')
    ok(keys && context !== null, 'Preset key and authored context are observable')
    await preset.click({ button: 'right' })
    await selectors.shortcutMenuItem(page, /^Remove shortcut/).click()
    for (let attempt = 0; attempt < 40; attempt++) {
      const entries = await overrides(page)
      if (
        entries.some(
          (entry) =>
            'unbind' in entry &&
            entry.unbind === COMMAND &&
            entry.keys === keys &&
            entry.context === (context || undefined),
        )
      )
        break
      await page.waitForTimeout(100)
    }
    ok(
      (await overrides(page)).some(
        (entry) =>
          'unbind' in entry &&
          entry.unbind === COMMAND &&
          entry.keys === keys &&
          entry.context === (context || undefined),
      ),
      'Remove targets the preset pair in its exact context',
    )
    await step('desktop-preset-cleared')
    await selectors.shortcutRow(page, COMMAND, keys, context).click({ button: 'right' })
    await selectors.shortcutMenuItem(page, /^Reset to default/).click()
    await waitForBindings(page, [])
    await step('desktop-preset-restored')

    await selectors.shortcutEntries(page).click()
    await selectors.shortcutEntryKeys(page).fill('F8')
    await selectors.shortcutEntryContext(page).fill('Terminal')
    await selectors.shortcutEntryAdd(page).click()
    await waitForBindings(page, [{ keys: 'F8', command: null, context: 'Terminal' }])
    await selectors.shortcutEntryKind(page).click()
    await selectors.shortcutEntryUnbindOption(page).click()
    await selectors.shortcutEntryKeys(page).fill('F9')
    await selectors.shortcutEntryCommand(page).fill('future::command')
    await selectors.shortcutEntryAdd(page).click()
    await waitForBindings(page, [
      { keys: 'F8', command: null, context: 'Terminal' },
      { keys: 'F9', unbind: 'future::command', context: 'Terminal' },
    ])
    await step('desktop-authored-order')
    await selectors.shortcutEntryDelete(page, 0).click()
    await waitForBindings(page, [{ keys: 'F9', unbind: 'future::command', context: 'Terminal' }])
    await step('desktop-targeted-delete')

    await page.setViewportSize({ width: 390, height: 844 })
    const home = new URL(page.url())
    home.pathname = `${home.pathname.split('/~')[0]}/`
    home.search = ''
    home.hash = ''
    await page.goto(home.href, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'New session', exact: true }).waitFor()
    await page.keyboard.press('ControlOrMeta+,')
    await selectors.settingsSearch(page).fill('keyboard')
    await selectors.shortcutsList(page).waitFor()
    await selectors.shortcutsSearch(page).fill(COMMAND)
    const narrow = selectors.shortcutRow(page, COMMAND).first()
    await narrow.waitFor()
    const height = (await narrow.boundingBox())?.height ?? 0
    ok(height >= 40, `Narrow row is a touch target at ${height}px`)
    await step('narrow-contextual-list')
    await narrow.click()
    await selectors.shortcutMenuItem(page, /^Change shortcut|^Add shortcut/).waitFor()
    await step('narrow-row-actions')
    await page.keyboard.press('Escape')
    await writeUserOperations(page, [{ kind: 'reset', keys: ['keybindings.overrides'] }])
    equal((await overrides(page)).length, 0)
  },
}
