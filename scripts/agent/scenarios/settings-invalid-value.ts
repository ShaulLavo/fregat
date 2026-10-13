import { ok, strictEqual } from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { selectors } from '../selectors'
import type { Scenario } from './index'

export const settingsInvalidValue: Scenario = {
  name: 'settings-invalid-value',
  description:
    'Save another setting beside an invalid font, then repair the font from its warning.',
  requiresIsolatedServer: true,
  async run(page, { server, step }) {
    ok(server, 'This scenario needs its throwaway settings home')
    const file = path.join(server.home, 'settings.json')
    const original = await readFile(file, 'utf8')
    try {
      await writeFile(
        file,
        JSON.stringify({ ...JSON.parse(original), 'editor.fontFamily': 'Fira Code' }),
      )
      await selectors.settingsOpen(page).click()
      await selectors.settingsSearch(page).fill('editor.fontSize')
      const field = selectors.settingsRow(page, 'editor.fontSize').getByRole('spinbutton')
      await field.fill('23')
      const saved = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith('/settings/write'),
      )
      await field.press('Enter')
      const response = await saved
      if (response.status() >= 400) await selectors.toast(page, 'Could not save settings').waitFor()
      await step('unrelated-setting-save')
      await waitForStored(page, file, (settings) => settings['editor.fontSize'] === 23)
      strictEqual(JSON.parse(await readFile(file, 'utf8'))['editor.fontFamily'], 'Fira Code')
      await selectors.settingsDiagnosticAction(page, 'editor.fontFamily', 'Choose font').click()
      strictEqual(await selectors.settingsSearch(page).inputValue(), 'editor.fontFamily')
      await selectors.settingsFontPicker(page, 'Code font').waitFor()
      await step('font-picker-repair')
      await selectors
        .settingsDiagnosticAction(page, 'editor.fontFamily', 'Reset to default')
        .click()
      await waitForStored(page, file, (settings) => !Object.hasOwn(settings, 'editor.fontFamily'))
      await selectors.settingsDiagnostic(page, 'editor.fontFamily').waitFor({ state: 'hidden' })
      strictEqual(JSON.parse(await readFile(file, 'utf8'))['editor.fontSize'], 23)
      await step('invalid-font-reset')

      const settings = JSON.parse(await readFile(file, 'utf8'))
      await writeFile(file, JSON.stringify({ ...settings, 'editor.fontFamily': 'Fira Code' }))
      await selectors.settingsDiagnostic(page, 'editor.fontFamily').waitFor()
      await selectors.settingsFontPicker(page, 'Code font').click()
      await selectors.fontPickerSearch(page).fill('jetbrains mono')
      await selectors
        .fontPickerOption(page, /^JetBrains Mono.*bundled/u)
        .first()
        .click()
      await waitForStored(page, file, (saved) => !Object.hasOwn(saved, 'editor.fontFamily'))
      await selectors.settingsDiagnostic(page, 'editor.fontFamily').waitFor({ state: 'hidden' })
      await step('fallback-font-selected')
    } finally {
      await writeFile(file, original)
    }
  },
}

async function waitForStored(
  page: Page,
  file: string,
  accept: (settings: Record<string, unknown>) => boolean,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (accept(JSON.parse(await readFile(file, 'utf8')))) return
    await page.waitForTimeout(100)
  }
  ok(false, 'The settings change did not reach disk')
}
