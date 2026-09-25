import { strictEqual } from 'node:assert/strict'

import type { Scenario } from './index'
import { openFileByName, selectors } from '../selectors'

export const problemsPanelWorkspace: Scenario = {
  name: 'problems-panel-workspace',
  readOnly: true,
  description:
    'Open a file in the real workspace without typing and fail unless Problems settles on an answer from every language server.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await selectors.bottomTab(page, 'Problems').click()
    // Every settled state; pending (`DiagnosticsLoading`) is none of them.
    await selectors
      .problemsSettled(page)
      .or(selectors.problemsTree(page))
      .first()
      .waitFor({ timeout: 60_000 })
    await step('settled')

    const failed = selectors.problemsFailedServers(page)
    const detail = (await failed.count()) > 0 ? await failed.innerText() : null
    strictEqual(detail, null, 'Every language server answers for the file')
  },
}
