import type { Page } from 'playwright'
import { startIsolatedServer } from './isolated-server'
import { selectors } from './selectors'
import { createScriptError } from '../structured-errors'

export type SecondOwner = {
  readonly origin: string
  stop(): Promise<void>
}

/**
 * Starts a second throwaway server from this checkout and connects it as a Remote URL machine,
 * so a run on one host has the two live owners the multi-owner scenarios need.
 */
export async function connectSecondOwner(page: Page, bases: ReadonlySet<string>) {
  const server = await startIsolatedServer(new URL(page.url()))
  try {
    await selectors.projectMenu(page).click()
    await selectors.connectMachineMenu(page).click()
    await selectors.machineDialog(page).waitFor()
    if (await selectors.machineAdd(page).isVisible()) await selectors.machineAdd(page).click()
    await selectors.machineRemoteUrl(page).click()
    await selectors.machineServerUrl(page).fill(server.origin)
    await selectors.machineConnect(page).click()
    await selectors.machineDialog(page).waitFor({ state: 'hidden', timeout: 30_000 })
    await waitForOwner(bases, server.origin)
  } catch (error) {
    await server.stop()
    throw error
  }
  return { origin: server.origin, stop: server.stop } satisfies SecondOwner
}

async function waitForOwner(bases: ReadonlySet<string>, origin: string) {
  const port = new URL(origin).port
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if ([...bases].some((base) => new URL(base).port === port)) return
    await Bun.sleep(200)
  }
  throw createScriptError(`The second owner at ${origin} never opened its orchestration socket`)
}
