import { ok } from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { workspaceAddressSchema } from '../../../packages/contracts/src/workspace-address'
import * as v from 'valibot'
import { fixtureApiBase, releaseFixture } from '../fixture-workspace'
import { scratchPath } from '../paths'
import { selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

export const workspaceLinkError: Scenario = {
  name: 'workspace-link-error',
  description: 'Open a saved link after its folder disappears and read the recovery guidance.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    await waitForApp(page)
    const fixture = await mkdtemp(scratchPath('fregat-workspace-link-'))
    const folder = path.join(fixture, 'project')
    try {
      await mkdir(folder)
      const current = new URL(page.url())
      const response = await page.request.post(`${fixtureApiBase(page)}/fs/workspace-address`, {
        data: { path: folder.slice(1) },
        headers: { Origin: current.origin },
      })
      ok(response.ok(), 'The existing folder can be registered')
      const workspace = v.parse(workspaceAddressSchema, await response.json())
      await rm(folder, { recursive: true })
      await page.goto(`${current.origin}/~${workspace.name}.${workspace.id}/workbench`)
      const notice = selectors.navigationError(page)
      await notice.waitFor({ timeout: 30_000 })
      await step('missing-workspace-folder')
      const text = await notice.innerText()
      ok(text.includes('saved workspace folder'), `The error names the workspace: ${text}`)
      ok(text.includes('Choose folder'), `The error explains how to recover: ${text}`)
      await selectors.chooseFolder(page).and(notice.getByRole('button')).click()
      await selectors.pickerDialog(page).waitFor()
      await step('choose-current-folder')
      const replacement = path.join(fixture, 'current-project')
      await mkdir(replacement)
      await writeFile(path.join(replacement, 'a.txt'), 'Workspace recovery fixture\n')
      await selectors.pickerGoToFolder(page).click()
      await selectors.pickerFolderPath(page).fill(replacement)
      await page.keyboard.press('Enter')
      await selectors.pickerBrowsing(page, replacement).waitFor()
      await selectors.pickerChoose(page).click()
      await selectors.pickerDialog(page).waitFor({ state: 'hidden' })
      await selectors.treeItem(page, 'a.txt').waitFor()
      await notice.waitFor({ state: 'hidden' })
      await step('recovered-workspace')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
