import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'

import { DEFAULT_PROVIDER_INSTANCE_ID } from '../../../packages/contracts/src/index'
import { selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'
import { dispatch, openChat, readShell } from './chat-verification'
import type { Scenario } from './index'

const AUTO_PULL = 'Keep the default branch current'

async function choose(page: Page, row: string, option: string) {
  await page.getByRole('combobox', { name: row, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

// The trigger also holds the select's hidden form value, so read the text a user sees.
async function shows(page: Page, matches: (text: string) => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const text = await page.locator('#project-auto-pull').innerText()
    if (matches(text.trim())) return
    await page.waitForTimeout(100)
  }
  throw createScriptError('The auto-pull override never showed its new value')
}

export const projectSettings: Scenario = {
  name: 'project-settings',
  description:
    "Open a project's settings from a session row's menu, set one override and return it to the machine default.",
  async run(page, { step }) {
    const base = await openChat(page)
    const shell = await readShell(page, base)
    const worktree = shell.worktrees.find((item) => item.path.endsWith('/projects/platform'))
    ok(worktree, 'Platform worktree must be registered')
    const project = shell.projects.find((item) => item.id === worktree.projectId)
    ok(project, 'The platform worktree must belong to a project')
    const sessionId = crypto.randomUUID()
    const title = `Project settings ${sessionId.slice(0, 8)}`
    // No turn runs here, so a project without a default model still works.
    const modelSelection = project.defaultModelSelection ?? {
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
      model: 'gpt-5.5',
    }
    try {
      await dispatch(page, base, {
        type: 'session.create',
        sessionId,
        title,
        modelSelection,
        worktreeTarget: { kind: 'current', worktreeId: worktree.id },
      })
      await selectors.sessionSearch(page).fill(title)
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await step('session-menu')
      await selectors.sessionLifecycleAction(page, 'Project Settings').click()
      const section = page.getByRole('region', { name: `${project.title} settings` })
      await section.waitFor({ timeout: 15_000 })
      const autoPull = page.getByRole('combobox', { name: AUTO_PULL, exact: true })
      await autoPull.waitFor()
      ok((await autoPull.textContent())?.startsWith('Default'), 'Starts on the machine default')
      await step('project-settings-open')

      await choose(page, AUTO_PULL, 'On')
      await shows(page, (text) => text === 'On')
      await step('override-on')

      await autoPull.click()
      await page.getByRole('option', { name: /^Default/ }).click()
      await shows(page, (text) => text.startsWith('Default'))
      await step('back-to-default')
    } finally {
      await dispatch(page, base, { type: 'session.delete', sessionId })
    }
  },
}
