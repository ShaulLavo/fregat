import type { Page } from 'playwright'
import { createScriptError } from '../structured-errors'
import { waitForApp } from './selectors'

export async function fixtureGit(project: string, args: readonly string[]) {
  const process = Bun.spawn(['git', '-C', project, ...args], { stdout: 'ignore', stderr: 'pipe' })
  if (await process.exited)
    throw createScriptError(`Fixture git failed: ${await new Response(process.stderr).text()}`)
}

export async function openFixtureWorkspace(page: Page, project: string) {
  const current = new URL(page.url())
  const prefix = current.pathname.startsWith('/platform/') ? '/platform' : ''
  const api = current.port === '5173' ? 'http://localhost:3001' : `${current.origin}${prefix}`
  const response = await page.request.post(`${api}/fs/workspace-address`, {
    data: { path: project.slice(1) },
    headers: { Origin: current.origin },
  })
  if (!response.ok()) throw createScriptError(`Fixture workspace failed: ${response.status()}`)
  const workspace = await response.json()
  const token = encodeURIComponent(`${workspace.name}.${workspace.id}`)
  await page.goto(`${current.origin}${prefix}/~${token}/workbench`)
  await waitForApp(page)
}
