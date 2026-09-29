import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'

import { selectors } from '../selectors'
import type { Scenario } from './index'

export const settingsEnumLabels: Scenario = {
  name: 'settings-enum-labels',
  description:
    'Settings dropdowns list their options by their titles ("On hover", "Wait for the agent"), never the stored ids.',
  readOnly: true,
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await openEnum(page, 'indent guides', 'File tree indent guides', [
      'Never',
      'On hover',
      'Always',
    ])
    await step('indent-guides-open')
    await page.keyboard.press('Escape')

    await openEnum(page, 'follow-up', 'Follow-up behavior', ['Wait for the agent', 'Send at once'])
    await step('follow-up-open')
    await page.keyboard.press('Escape')
  },
}

async function openEnum(page: Page, query: string, title: string, options: readonly string[]) {
  await selectors.settingsSearch(page).fill(query)
  await selectors.settingsEnum(page, title).click()
  for (const name of options)
    await page.getByRole('option', { name, exact: true }).waitFor({ timeout: 5000 })
  const listed = await page.getByRole('option').allInnerTexts()
  ok(
    listed.every((text) => options.includes(text.trim())),
    `unexpected option labels: ${listed.join(', ')}`,
  )
  // The popup animates in; screenshot once it rests.
  await page.waitForTimeout(400)
}
