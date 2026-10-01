import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import { expect, test } from 'vitest'
import { selectAvailablePort, isPortAvailable } from '../runtime-network'
import { committedFixture } from './fixture-workspace'
import { createEvidence } from './evidence'
import { readLogs } from './logs'
import { startIsolatedServer } from './isolated-server'
import { checkoutRoot, scratchPath } from './paths'
import { isolatedNativeScenario } from './scenarios/native-provider-verification'
import { selectors, waitForApp } from './selectors'
import { launchBrowser } from './browser-launch'
import type { Browser } from 'playwright'

test('native fixture opens its workspace before reloading its provider snapshot', async () => {
  const scratch = await mkdtemp(scratchPath('fregat-native-startup-'))
  const port = await selectAvailablePort({
    preferredPort: 5496,
    isAvailable: (candidate) => isPortAvailable('127.0.0.1', candidate),
  })
  const webOrigin = new URL(`http://localhost:${port}`)
  const vite = await createServer({
    root: path.join(checkoutRoot, 'apps/web'),
    configFile: path.join(checkoutRoot, 'apps/web/vite.config.ts'),
    cacheDir: path.join(scratch, 'vite-cache'),
    server: { host: '127.0.0.1', port, strictPort: true },
  })
  let server: Awaited<ReturnType<typeof startIsolatedServer>> | undefined
  let browser: Browser | undefined
  try {
    await vite.listen()
    const nodeEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      server = await startIsolatedServer(webOrigin)
    } finally {
      process.env.NODE_ENV = nodeEnvironment
    }
    browser = await launchBrowser('chromium', false)
    const page = await browser.newPage()
    const failures: unknown[] = []
    const consoleMessages: string[] = []
    page.on('console', (message) => consoleMessages.push(message.text()))
    const navigations: {
      url: string
      workspaceTitle: string | null
      composerNamespace: string | null
    }[] = []
    await page.exposeFunction('recordFixtureFetchFailure', (failure: unknown) =>
      failures.push(failure),
    )
    await page.exposeFunction(
      'recordFixtureNavigation',
      (navigation: {
        url: string
        workspaceTitle: string | null
        composerNamespace: string | null
      }) => navigations.push(navigation),
    )
    await page.addInitScript((origin) => {
      window.platformDevServerUrl = origin
      const original = window.fetch
      let unloading = false
      window.addEventListener('beforeunload', () => {
        unloading = true
        const composer = document.querySelector('[data-testid="chat-input-editor"]') as
          | (HTMLElement & { __lexicalEditor?: { _config: { namespace: string } } })
          | null
        void (
          window as unknown as { recordFixtureNavigation: (value: unknown) => Promise<void> }
        ).recordFixtureNavigation({
          url: location.href,
          workspaceTitle: document
            .querySelector('[aria-label="Switch project"]')
            ?.getAttribute('title'),
          composerNamespace: composer?.__lexicalEditor?._config.namespace ?? null,
        })
      })
      // Bun declares fetch.preconnect; browser fetch has no preconnect method.
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        try {
          return await original(input, init)
        } catch (error) {
          const failure = {
            url: String(input),
            page: location.href,
            message: String(error),
            aborted: init?.signal?.aborted ?? false,
            unloading,
          }
          console.debug(`fixture-startup-fetch-rejection ${JSON.stringify(failure)}`)
          void (
            window as unknown as { recordFixtureFetchFailure: (value: unknown) => Promise<void> }
          ).recordFixtureFetchFailure(failure)
          throw error
        }
      }) as typeof fetch
    }, server.origin)
    const addressResponse = await page.request.post(`${server.origin}/fs/workspace-address`, {
      headers: { Origin: webOrigin.origin },
      data: { path: checkoutRoot.slice(1) },
    })
    expect(addressResponse.ok()).toBe(true)
    const address = await addressResponse.json()
    await page.goto(`${webOrigin.origin}/~${address.name}.${address.id}/chat`)
    await waitForApp(page)
    await selectors
      .projectSwitcher(page)
      .and(page.locator(`[title^="${checkoutRoot.slice(1)}"]`))
      .waitFor()
    let fixturePath = ''
    let fixtureSessionId = ''
    const scenario = isolatedNativeScenario({
      name: 'native-workspace-startup',
      description: 'Open a disposable native fixture workspace.',
      fixture: new URL('./fixtures/native-conversation.mjs', import.meta.url),
      prepareWorktree: async () => {
        const fixture = await committedFixture('native-workspace-startup')
        fixturePath = fixture.path
        return fixture
      },
      drive: async (_page, { sessionId }) => {
        fixtureSessionId = sessionId
      },
    })
    const evidence = await createEvidence('scenario', 'native-workspace-startup')
    await scenario.run(page, { evidence, server, step: async () => undefined, file: 'a.txt' })
    const logs = await readLogs({ directory: server.logs, since: evidence.startedAt })
    const rpcFailures = logs.filter(
      (event) =>
        event.path === fixturePath.slice(1) && JSON.stringify(event).includes('client.RPC_FAILED'),
    )
    await evidence.json('startup.json', {
      fixturePath,
      fixtureSessionId,
      failures,
      navigations,
      rpcFailures,
      logs,
      consoleMessages,
    })
    console.log(
      JSON.stringify({ evidence: evidence.dir, navigations, rpcFailureCount: rpcFailures.length }),
    )
    const reloads = navigations.filter((navigation) =>
      new URL(navigation.url).pathname.endsWith(`/chat/t/${fixtureSessionId}`),
    )
    expect(reloads).toHaveLength(1)
    const reload = reloads[0]!
    expect(reload.workspaceTitle).toContain(fixturePath.slice(1))
    expect(reload.composerNamespace).toBeTypeOf('string')
    expect(reload.composerNamespace?.endsWith(`:${fixturePath.slice(1)}:${fixtureSessionId}`)).toBe(
      true,
    )
    expect(rpcFailures).toEqual([])
  } finally {
    const cleanup = await Promise.allSettled([browser?.close(), server?.stop(), vite.close()])
    await rm(scratch, { recursive: true, force: true })
    expect(cleanup.filter((result) => result.status === 'rejected')).toEqual([])
  }
}, 90_000)
