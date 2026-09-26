import { strictEqual } from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Scenario } from './index'
import {
  createGitFixture,
  fixtureApiBase,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { runPaletteCommand, selectors } from '../selectors'
import { dispatch, readShell } from './chat-verification'
import { registerFixtureProject } from './native-provider-verification'
import { createScriptError } from '../../structured-errors'

const PROJECT_FILE = {
  scripts: [
    {
      name: 'Install',
      command: 'echo "$PLATFORM_WORKTREE_PATH" > setup-ran.txt && echo installed',
      runOnWorktreeCreate: true,
      async: false,
    },
  ],
}

export const worktreeSetupImport: Scenario = {
  name: 'worktree-setup-import',
  description:
    'A repository with a t3.json setup script: nothing runs until Import scripts from t3.json; after it, a new session worktree runs the setup before it is ready.',
  async run(page, { step }) {
    const fixture = await createGitFixture('setup-import')
    try {
      await writeFile(path.join(fixture, 't3.json'), JSON.stringify(PROJECT_FILE))
      await fixtureGit(fixture, ['add', '--all'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'project file'])
      await openFixtureWorkspace(page, fixture)
      const orchestration = `${fixtureApiBase(page)}/orchestration`
      const base = await registerFixtureProject(page, orchestration, fixture)

      await runPaletteCommand(page, 'Run project script')
      const importRow = page.getByRole('option', { name: 'Import scripts from t3.json' })
      await importRow.waitFor({ timeout: 15_000 })
      const preview = selectors.paletteOptions(page).filter({ hasText: 'Install' })
      strictEqual(await preview.getAttribute('aria-disabled'), 'true')
      await step('import-offered')
      await importRow.click()
      await selectors.toast(page, 'Imported 1 script').waitFor({ timeout: 15_000 })
      const project = (await readShell(page, orchestration)).projects.find(
        (item) => item.id === base.projectId,
      )
      const saved = project?.scripts.find((script) => script.name === 'Install')
      if (!saved?.runOnWorktreeCreate || !saved.waitForSetup)
        throw createScriptError(`The import lost the setup flags: ${JSON.stringify(saved)}`)
      await step('imported')

      const worktreeId = crypto.randomUUID()
      await dispatch(page, orchestration, {
        type: 'session.create',
        sessionId: crypto.randomUUID(),
        title: 'Setup import verification',
        worktreeTarget: { kind: 'new', worktreeId, baseWorktreeId: base.id },
        modelSelection: { providerInstanceId: 'codex', model: 'gpt-5.5' },
      })
      let worktree = null
      for (let attempt = 0; attempt < 100 && worktree?.lifecycle.state !== 'ready'; attempt += 1) {
        await Bun.sleep(100)
        worktree =
          (await readShell(page, orchestration)).worktrees.find((item) => item.id === worktreeId) ??
          null
      }
      if (worktree?.lifecycle.state !== 'ready' || worktree.setup?.state !== 'done')
        throw createScriptError(
          `Setup did not finish before ready: ${JSON.stringify(worktree?.setup)}`,
        )
      const ran = (
        await readFile(path.join(worktree.canonicalPath, 'setup-ran.txt'), 'utf8')
      ).trim()
      if (ran !== worktree.canonicalPath)
        throw createScriptError(`Setup ran in ${ran}, not the new worktree`)
      await step('setup-ran-in-worktree')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
