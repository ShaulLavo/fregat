import { ok } from 'node:assert/strict'
import { chords, focusEditor, openFileByName, selectors } from '../selectors'
import type { Scenario } from './index'

export const commandPaletteTypeBurst: Scenario = {
  name: 'command-palette-type-burst',
  description: 'From an editor origin, type a command query at 70ms per key, then a file query.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    // An editor origin lists the most commands, so it is the expensive case.
    await focusEditor(page)
    await page.keyboard.press(chords.commandPalette)
    const input = selectors.paletteInput(page)
    await input.waitFor()
    await input.fill('>')
    const availability = await selectors
      .paletteOptions(page)
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-disabled') === 'true'))
    const firstDisabled = availability.indexOf(true)
    ok(firstDisabled > 0, 'The palette must contain enabled and disabled commands')
    ok(
      availability.slice(firstDisabled).every(Boolean),
      'Disabled commands must follow enabled commands',
    )
    await step('initial-commands')
    await page.keyboard.type('toggle sidebar', { delay: 70 })
    const rows = await selectors.paletteOptions(page).count()
    ok(rows > 0, 'The command query must leave at least one row')
    console.log(JSON.stringify({ commandRows: rows }))
    await step('commands')
    // Files mode lists no commands, so it must not pay for a capture.
    await input.fill('')
    await page.keyboard.type('package json', { delay: 70 })
    await step('files')
    await page.keyboard.press('Escape')
  },
}
