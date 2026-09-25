import { ok } from 'node:assert/strict'
import { BUNDLED_THEMES } from '../../../packages/contracts/src/index'
import { selectors } from '../selectors'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import { isolatedNativeScenario } from './native-provider-verification'

export const spinnerPalette = isolatedNativeScenario({
  name: 'spinner-palette',
  description:
    'A working session draws its rail, header and timeline spinners from the theme primary, in dark and light.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, sessionId }) {
    const sage = BUNDLED_THEMES.find((theme) => theme.id === 'sage')
    ok(sage, 'Bundled Sage theme exists')
    const restore = await preserveAppearance(page)
    try {
      await writeUserSetting(page, 'workbench.theme', sage)
      await writeUserSetting(page, 'workbench.colorTheme', 'dark')
      const title = `spinner-palette verification ${sessionId.slice(0, 8)}`
      await selectors.chatMessage(page).fill('Keep working.')
      await selectors.chatSend(page).click()
      await selectors.sessionStatus(page, title, 'Working').waitFor()
      await step('sage-dark-working')
      await writeUserSetting(page, 'workbench.colorTheme', 'light')
      await selectors.sessionStatus(page, title, 'Working').waitFor()
      await step('sage-light-working')
    } finally {
      await restore()
    }
  },
})
