import { writeUserOperations } from '../preserve-settings'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const settingsValueGrids: Scenario = {
  name: 'settings-value-grids',
  description:
    'A machine lists its name and SSH target on separate rows, and each provider its binary. Writes only the throwaway server.',
  async run(page, { step }) {
    await writeUserOperations(page, [
      {
        kind: 'machine.set',
        name: 'build-box',
        machine: { kind: 'ssh', target: 'shaul@build-box.tailnet.example', label: 'Build box' },
      },
    ])
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('Connected machines')
    await selectors.valueGridRow(page, 'SSH target').waitFor()
    await step('machine-values')

    await selectors.settingsSearch(page).fill('providers')
    await selectors.valueGridRow(page, 'Binary').first().waitFor()
    await step('provider-values')
  },
}
