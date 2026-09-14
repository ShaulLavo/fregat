import type { Scenario } from './index'
import { selectors } from '../selectors'

export const demoAgentGit: Scenario = {
  name: 'demo-agent-git',
  surface: 'demo',
  description:
    'Stage and commit the seeded change, then ask the simulated agent about the project.',
  inspect: (page) => page.evaluate('window.__fregatDemo ?? null'),
  async run(page, { step }) {
    await selectors.editorInput(page).first().waitFor({ timeout: 30_000 })
    await selectors.sidebarTab(page, 'Git').click()
    await selectors.changesHeader(page).hover()
    await selectors.stageChanges(page).click()
    await page.waitForTimeout(500)
    await step('staged')
    await selectors.commitMessage(page).fill('Prepare the garden for autumn')
    await selectors.commitMessage(page).press('Control+Enter')
    await page.waitForFunction(
      `async () => {
      const response = await fetch(window.__fregatDemo.apiOrigin + '/git/status?path=/garden');
      const status = await response.json();
      return status.files?.length === 0;
    }`,
      undefined,
      { timeout: 15_000 },
    )
    await step('committed')
    await selectors.sidebarTab(page, 'Chat').click()
    await selectors.chatMessage(page).click()
    await step('composer')
    await page.keyboard.type('How does the planting schedule work?', { delay: 25 })
    await step('prompt')
    await selectors.chatSend(page).click()
    await selectors
      .chatMessages(page)
      .getByText('The planting schedule lives in', { exact: false })
      .waitFor({ timeout: 20_000 })
    await page.waitForTimeout(3_000)
    await step('agent-reply')
  },
}
