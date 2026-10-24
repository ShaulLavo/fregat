import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { expect, test } from 'vitest'
import { selectAvailablePort, isPortAvailable } from '../runtime-network'
import { committedFixture } from './fixture-workspace'
import { createEvidence } from './evidence'
import { readLogs } from './logs'
import { routeHtmlBootstrap } from './html-bootstrap'
import { attachObserver, serializable, type Observed } from './observe.mjs'
import { startIsolatedServer } from './isolated-server'
import { checkoutRoot, scratchPath } from './paths'
import { isolatedNativeScenario } from './scenarios/native-provider-verification'
import { selectors, waitForApp } from './selectors'
import { launchBrowser } from './browser-launch'
import { chromiumUnavailable } from './browser-prerequisites'
import type { Browser, Page } from 'playwright'

const it = test.skipIf(chromiumUnavailable)

it('native fixture opens its workspace before reloading its provider snapshot', async () => {
  const evidence = await createEvidence('scenario', 'native-workspace-startup')
  const scratch = await mkdtemp(scratchPath('fregat-native-startup-'))
  let vite: ViteDevServer | undefined
  let server: Awaited<ReturnType<typeof startIsolatedServer>> | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let observed: Observed | undefined
  const consoleMessages: string[] = []
  console.log(JSON.stringify({ evidence: evidence.dir }))
  try {
    const port = await selectAvailablePort({
      preferredPort: 5496,
      isAvailable: (candidate) => isPortAvailable('127.0.0.1', candidate),
    })
    const webOrigin = new URL(`http://localhost:${port}`)
    vite = await createServer({
      root: path.join(checkoutRoot, 'apps/web'),
      configFile: path.join(checkoutRoot, 'apps/web/vite.config.ts'),
      cacheDir: path.join(scratch, 'vite-cache'),
      server: { host: '127.0.0.1', port, strictPort: true },
    })
    await vite.listen()
    const nodeEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      server = await startIsolatedServer(webOrigin)
    } finally {
      process.env.NODE_ENV = nodeEnvironment
    }
    browser = await launchBrowser('chromium', false)
    page = await browser.newPage()
    observed = attachObserver(page, server.origin)
    await routeHtmlBootstrap(page.context(), webOrigin.origin, server.origin)
    const failures: unknown[] = []
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
    const documentResponse = await page.goto(
      `${webOrigin.origin}/~${address.name}.${address.id}/chat`,
    )
    expect(documentResponse?.status()).toBe(200)
    await waitForApp(page)
    await selectors
      .projectSwitcher(page)
      .and(page.locator(`[title^="${checkoutRoot.slice(1)}"]`))
      .waitFor()
    const health = await page.request.get(`${server.origin}/health`, {
      headers: { Origin: webOrigin.origin },
    })
    expect(health.ok()).toBe(true)
    const { environmentId } = (await health.json()) as { environmentId: string }
    expect(environmentId).toBeTypeOf('string')
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
      drive: async (fixturePage, { sessionId }) => {
        fixtureSessionId = sessionId
        await fixturePage.screenshot({ path: evidence.file('workspace-ready.png') })
      },
    })
    await scenario.run(page, { evidence, server, step: async () => undefined, file: 'a.txt' })
    const logs = await readLogs({ directory: server.logs, since: evidence.startedAt })
    const rpcFailures = logs.filter(
      (event) =>
        event.path === fixturePath.slice(1) && JSON.stringify(event).includes('client.RPC_FAILED'),
    )
    await evidence.json('startup.json', {
      fixturePath,
      fixtureSessionId,
      environmentId,
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
    expect(reload.composerNamespace).toBe(
      `platform-chat-input:${environmentId}:${fixturePath.slice(1)}:${fixtureSessionId}`,
    )
    expect(rpcFailures).toEqual([])
  } finally {
    const captures: Promise<unknown>[] = [
      evidence.json('observed.json', observed ? serializable(observed) : null),
      evidence.json('console.json', consoleMessages),
    ]
    if (page)
      captures.push(
        page
          .locator('body')
          .innerText()
          .then((body) => evidence.write('body.txt', body)),
        page.screenshot({ path: evidence.file('startup.png') }),
      )
    if (server)
      captures.push(
        readLogs({ directory: server.logs, since: evidence.startedAt }).then((logs) =>
          evidence.json('logs.json', logs),
        ),
        readFile(path.join(server.directory, 'server.stdout')).then((text) =>
          evidence.write('server.stdout', text),
        ),
        readFile(path.join(server.directory, 'server.stderr')).then((text) =>
          evidence.write('server.stderr', text),
        ),
      )
    const captured = await Promise.allSettled(captures)
    const cleanup = await Promise.allSettled([browser?.close(), server?.stop(), vite?.close()])
    await rm(scratch, { recursive: true, force: true })
    expect(captured.filter((result) => result.status === 'rejected')).toEqual([])
    expect(cleanup.filter((result) => result.status === 'rejected')).toEqual([])
  }
}, 90_000)
