import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'

import { runPaletteCommand, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'
import { openChat, readShell } from './chat-verification'
import { createMockProviderSession } from './mock-provider-session'
import type { Scenario } from './index'

const AUTO_PULL = 'Keep the default branch current'

async function choose(page: Page, row: string, option: string) {
  await selectors.projectSetting(page, row).click()
  await selectors.projectSettingOption(page, option).click()
}

// The trigger also holds the select's hidden form value, so read the text a user sees.
async function shows(page: Page, matches: (text: string) => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const text = await selectors.projectSetting(page, AUTO_PULL).innerText()
    if (matches(text.trim())) return
    await page.waitForTimeout(100)
  }
  throw createScriptError('The auto-pull override never showed its new value')
}

export const projectSettings: Scenario = {
  name: 'project-settings',
  description:
    'Open project settings from both menus, recover from remembered JSON and Defaults views, edit an override, and navigate to Usage and Font settings with a mock session.',
  async run(page, { step }) {
    const base = await openChat(page)
    const fixture = await createMockProviderSession(page, base, {
      name: 'project-settings',
      displayLabel: 'Project settings fixture',
      config: {},
    })
    const title = `project-settings ${fixture.sessionId.slice(0, 8)}`
    try {
      const shell = await readShell(page, base)
      const worktree = shell.worktrees[0]
      const project = shell.projects.find((item) => item.id === worktree?.projectId)
      ok(project, 'The fixture worktree must belong to a project')
      await selectors.sessionSearch(page).fill(title)
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await step('session-menu')
      await selectors.sessionLifecycleAction(page, 'Project Settings').click()
      const section = selectors.projectSettingsSection(page, project.title)
      await section.waitFor({ timeout: 15_000 })
      const autoPull = selectors.projectSetting(page, AUTO_PULL)
      await autoPull.waitFor()
      ok((await autoPull.textContent())?.startsWith('Default'), 'Starts on the machine default')
      await step('project-settings-open')

      await choose(page, AUTO_PULL, 'On')
      await shows(page, (text) => text === 'On')
      await step('override-on')

      await autoPull.click()
      await selectors.projectSettingOption(page, /^Default/).click()
      await shows(page, (text) => text.startsWith('Default'))
      await step('back-to-default')

      for (const remembered of ['json', 'Defaults'] as const) {
        await selectors.settingsShowAll(page).click()
        if (remembered === 'json') await selectors.settingsJsonView(page).click()
        else await selectors.settingsScopeTab(page, remembered).click()
        await step(`remembered-${remembered}`)
        await selectors.sessionByTitle(page, title).click({ button: 'right' })
        await selectors.sessionLifecycleAction(page, 'Project Settings').click()
        await autoPull.waitFor()
        ok(
          (await selectors.settingsScopeTab(page, 'User').getAttribute('aria-selected')) === 'true',
        )
        await step(`project-from-${remembered}`)
      }

      await runPaletteCommand(page, 'Open usage')
      await selectors.settingsCategoryHeading(page, 'Usage').waitFor()
      await step('usage-after-project')
      await selectors.projectGroups(page).first().click({ button: 'right' })
      await selectors.sessionLifecycleAction(page, 'Project Settings').click()
      await autoPull.waitFor()
      await step('project-menu-settings')
      await runPaletteCommand(page, 'Open font settings')
      await selectors.settingsFontPicker(page, 'Code font').waitFor()
      await step('font-after-project')
    } finally {
      await fixture.cleanup()
    }
  },
}
