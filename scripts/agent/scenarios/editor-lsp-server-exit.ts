import { ok } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Scenario } from './index'
import { openFixtureWorkspace, processesIn, releaseFixture } from '../fixture-workspace'
import { focusEditor, openFileFromTree, selectors, waitForLspErrorPaint } from '../selectors'

export const editorLspServerExit: Scenario = {
  name: 'editor-lsp-server-exit',
  description:
    'Kill the language server behind an open TypeScript file and check the toast says it stopped and what to do.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp('/work/tmp/fregat-lsp-exit-')
    try {
      await writeFile(
        path.join(fixture, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }),
      )
      await writeFile(path.join(fixture, 'exit.ts'), 'export const value: number = "wrong"\n')
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'exit.ts')
      await focusEditor(page)
      await waitForLspErrorPaint(page)
      await step('diagnostics-visible')
      // Only this fixture's language server: not the user's, and not the fixture's terminal shell.
      const servers = await processesIn(fixture, notTerminal)
      ok(servers.length > 0, 'a language server runs in the fixture root')
      for (const pid of servers) process.kill(pid, 'SIGKILL')
      const toast = selectors.toast(page, 'language server stopped')
      await toast.waitFor({ timeout: 10_000 })
      await page.waitForTimeout(500)
      ok(/Run the language server from a terminal/.test(await toast.innerText()), 'names the fix')
      await step('server-exit-toast')
    } catch (error) {
      await step('failure-before-cleanup')
      throw error
    } finally {
      await page.goto(originalUrl)
      await releaseFixture(fixture)
    }
  },
}

function notTerminal(stdin: string) {
  return stdin !== '' && !stdin.startsWith('/dev/pts/')
}
