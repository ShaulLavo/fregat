import { ok } from 'node:assert/strict'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const themeStudioSettings: Scenario = {
  name: 'theme-studio-settings',
  description: 'Open Theme studio from Settings on desktop and phone, switch tabs, and close it.',
  capture: { width: 1440, height: 844 },
  async run(page, { step }) {
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      if (width < 768) await selectors.phoneShell(page).waitFor()
      if (!(await selectors.themeStudioOpen(page).isVisible()))
        await selectors.settingsOpen(page).click()
      await selectors.themeStudioOpen(page).click()
      try {
        await selectors.themeStudio(page).waitFor({ timeout: 5000 })
      } catch (error) {
        await step(`studio-missing-${width}`)
        throw error
      }
      await step(`studio-open-${width}`)
      const studio = selectors.themeStudio(page)
      const bounds = await studio.boundingBox()
      ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1)
      await selectors.themeStudioTab(page, 'Surfaces').click()
      await step(`studio-surfaces-${width}`)
      await studio.getByRole('button', { name: 'Hide the studio', exact: true }).click()
      await studio.getByRole('button', { name: 'Show the studio', exact: true }).click()
      await selectors.themeStudioTab(page, 'Colors').click()
      const accent = studio.getByRole('textbox', { name: 'Accent', exact: true })
      await accent.fill('#d33682')
      await accent.press('Enter')
      await studio.getByRole('button', { name: 'Close', exact: true }).click()
      await studio.getByText('Repeat to drop your edits', { exact: true }).waitFor()
      await step(`studio-discard-confirmation-${width}`)
      await studio.getByRole('button', { name: 'Close', exact: true }).click()
      await studio.waitFor({ state: 'detached' })
    }
  },
}
