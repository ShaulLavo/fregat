import { ok, strictEqual } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { createScriptError } from '../../structured-errors'
import type { Scenario } from './index'
import { openFixtureWorkspace, processesIn, releaseFixture } from '../fixture-workspace'
import { focusEditor, openFileFromTree, selectors, waitForLspErrorPaint } from '../selectors'

export const editorLspServerExit: Scenario = {
  name: 'editor-lsp-server-exit',
  description:
    'Kill the language server behind an open TypeScript file: it restarts and diagnostics return with no toast. Keep killing it and the toast says it stopped and what to do.',
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

      const first = await killServers(fixture)
      await waitForRestart(fixture, first)
      await waitForLspErrorPaint(page)
      strictEqual(await toast(page).count(), 0, 'a server that restarted is not an error')
      await step('restarted-without-toast')

      // A server that dies every time it starts runs out the reconnect attempts. The toast closes
      // on its own, so it is looked for between kills rather than after the last one.
      await killUntilToast(page, fixture)
      ok(
        /Run the language server from a terminal/.test(await toast(page).innerText()),
        'names the fix',
      )
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

function toast(page: Page) {
  return selectors.toast(page, 'language server stopped')
}

/** Only this fixture's language server: not the user's, and not the fixture's terminal shell. */
async function killServers(fixture: string) {
  const servers = await processesIn(fixture, notTerminal)
  ok(servers.length > 0, 'a language server runs in the fixture root')
  for (const pid of servers) process.kill(pid, 'SIGKILL')
  return new Set(servers)
}

async function killUntilToast(page: Page, fixture: string) {
  let killed = await killServers(fixture)
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await toast(page).isVisible()) return
    const servers = await processesIn(fixture, notTerminal)
    if (servers.some((pid) => !killed.has(pid))) killed = await killServers(fixture)
    await page.waitForTimeout(200)
  }
  throw createScriptError('the language server kept restarting without the toast')
}

async function waitForRestart(fixture: string, killed: ReadonlySet<number>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const servers = await processesIn(fixture, notTerminal)
    if (servers.some((pid) => !killed.has(pid))) return servers
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw createScriptError('the language server did not restart')
}

function notTerminal(stdin: string) {
  return stdin !== '' && !stdin.startsWith('/dev/pts/')
}
