import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { browserProcessFacts } from '../diagnostics'
import { chromiumArguments } from '../profile'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { startupBudget } from '../startup'
import { launchChromium, type ChromiumWindow } from '../chromium'
import type { CdpClient } from '../cdp'
import type { BrowserCandidate } from '../browser'

const executable =
  Bun.which('chromium') ?? Bun.which('google-chrome') ?? Bun.which('google-chrome-stable')
const native = Boolean(process.env.WAYLAND_DISPLAY || process.env.DISPLAY)
const pollCleanupMarginMs = 60_000
// Lifecycle polls and cleanup need their own budget after bounded browser launches.
const smokeTimeoutMs = startupBudget().limitMs * (native ? 3 : 1) + pollCleanupMarginMs
const fixtureHtml =
  '<!doctype html><html><head><title>Platform desktop fixture</title></head><body><h1>Platform desktop fixture</h1><p>Browser bridge and window lifecycle verification</p></body></html>'

async function pages(cdp: CdpClient) {
  const result = await cdp.request('Target.getTargets')
  return (result.targetInfos as { targetId: string; type: string; url: string }[]).filter(
    (target) => target.type === 'page',
  )
}
async function evaluate(
  cdp: CdpClient,
  sessions: Map<string, string>,
  targetId: string,
  expression: string,
) {
  let sessionId = sessions.get(targetId)
  if (!sessionId) {
    const attached = await cdp.request('Target.attachToTarget', { targetId, flatten: true })
    sessionId = attached.sessionId as string
    sessions.set(targetId, sessionId)
  }
  const result = await cdp.request(
    'Runtime.evaluate',
    { expression, returnByValue: true },
    sessionId,
  )
  return (result.result as { value?: unknown }).value
}
async function until(condition: string, check: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await check()) return
    await Bun.sleep(50)
  }
  expect.fail(`Fixture browser condition timed out: ${condition}`)
}

test.skipIf(!executable)(
  'real Chromium bridges windows and preserves fixture service; native launch hands off its singleton',
  async () => {
    const scratch = await mkdtemp(
      path.join(existsSync('/work/tmp') ? '/work/tmp' : tmpdir(), 'polaron-smoke-'),
    )
    const candidate: BrowserCandidate = {
      kind: 'chromium',
      executable: executable!,
      args: [],
      confinement: 'none',
      source: 'setting',
      family: 'chromium',
    }
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response(fixtureHtml, { headers: { 'Content-Type': 'text/html' } }),
    })
    const url = `http://127.0.0.1:${server.port}/`
    let first: ChromiumWindow | undefined
    let second: ChromiumWindow | undefined
    let independent: ChromiumWindow | undefined
    const telemetry: Record<string, unknown>[] = []
    const failures: unknown[] = []
    let step = 'launch'
    const exits: unknown[] = []
    try {
      // CI has no compositor; its browser still exercises the production CDP pipe and profile.
      if (!native) candidate.args = ['--headless', '--no-sandbox']
      if (process.env.WAYLAND_DISPLAY) candidate.args = ['--ozone-platform=wayland']
      let restrictedUserNamespaces: boolean | null = null
      try {
        restrictedUserNamespaces =
          readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() ===
          '1'
      } catch {}
      console.info('smoke startup inputs', {
        selectedCommand: path.basename(executable!),
        canonicalCommand: path.basename(realpathSync(executable!)),
        native,
        headless: candidate.args.includes('--headless'),
        noSandbox: candidate.args.includes('--no-sandbox'),
        restrictedUserNamespaces,
        argumentNames: chromiumArguments(
          candidate,
          path.join(scratch, 'desktop/chromium'),
          url,
        ).map((argument) => argument.split('=')[0]),
      })
      const launchedAt = performance.now()
      first = await launchChromium({
        candidate,
        stateHome: scratch,
        home: scratch,
        url,
        startup: startupBudget(),
        onOpen: (event) => telemetry.push(event),
        onExit: (exit) => exits.push(exit),
        onFailure: (error) => failures.push(error),
      })
      const startupMs = Math.round(performance.now() - launchedAt)
      expect(first.kind).toBe('owned')
      if (first.kind !== 'owned') return
      const owner = first
      const processInfo = await owner.cdp.request('SystemInfo.getProcessInfo')
      const browserProcess = (processInfo.processInfo as { type: string; id: number }[]).find(
        (process) => process.type === 'browser',
      )
      expect(browserProcess).toBeDefined()
      console.info('smoke known-good transport', {
        startupMs,
        transport: owner.cdp.snapshot(),
        ...browserProcessFacts(browserProcess!.id, executable!, []),
      })
      const sessions = new Map<string, string>()
      step = 'initial-window-bridge'
      await until(step, async () => {
        const targets = await pages(owner.cdp)
        if (!targets[0]) return false
        return Boolean(
          await evaluate(
            owner.cdp,
            sessions,
            targets[0].targetId,
            'globalThis.platformBridge?.titlebar === "native" && typeof globalThis.platformBridge.pickEntry === "function"',
          ),
        )
      })
      step = 'screenshot'
      const initial = await pages(owner.cdp)
      const screenshotSession = await owner.cdp.request('Target.attachToTarget', {
        targetId: initial[0]!.targetId,
        flatten: true,
      })
      const screenshot = await owner.cdp.request(
        'Page.captureScreenshot',
        { format: 'png' },
        screenshotSession.sessionId as string,
      )
      await writeFile(
        path.join(scratch, 'window.png'),
        Buffer.from(screenshot.data as string, 'base64'),
      )
      step = 'new-window'
      await owner.cdp.request('Target.createTarget', { url, newWindow: true })
      await until('second-window-count', async () => (await pages(owner.cdp)).length === 2)
      for (const target of await pages(owner.cdp)) {
        await until(`${step}-bridge:${target.targetId}`, async () =>
          Boolean(
            await evaluate(
              owner.cdp,
              sessions,
              target.targetId,
              'globalThis.platformBridge?.titlebar === "native"',
            ),
          ),
        )
      }
      if (native) {
        step = 'singleton'
        second = await launchChromium({
          candidate,
          stateHome: scratch,
          home: scratch,
          url,
          startup: startupBudget(),
          onOpen: () => {},
          onExit: (exit) => exits.push({ second: true, ...exit }),
          onFailure: (error) => failures.push(error),
        })
        expect(second.kind).toBe('handoff')
        await until('singleton-window-count', async () => (await pages(owner.cdp)).length === 3)
        for (const target of await pages(owner.cdp)) {
          await until(`${step}-bridge:${target.targetId}`, async () =>
            Boolean(
              await evaluate(
                owner.cdp,
                sessions,
                target.targetId,
                'globalThis.platformBridge?.titlebar === "native"',
              ),
            ),
          )
        }
      }
      step = 'telemetry'
      await until('frame-telemetry', async () => telemetry.length > 0)
      expect(telemetry[0]).toMatchObject({ engine: 'chromium' })
      expect(telemetry[0]!.rafPerSecond).toBeGreaterThan(0)
      if (native) {
        step = 'independent-owner'
        independent = await launchChromium({
          candidate,
          stateHome: path.join(scratch, 'independent'),
          home: scratch,
          url,
          startup: startupBudget(),
          onOpen: () => {},
          onFailure: (error) => failures.push(error),
        })
        expect(independent.kind).toBe('owned')
        step = 'rejected-startup'
        await expect(
          launchChromium({
            candidate: {
              ...candidate,
              executable: process.execPath,
              args: [
                path.join(import.meta.dirname, 'fixtures/browser.mjs'),
                'old-version',
                path.join(scratch, 'rejected-pid'),
              ],
            },
            stateHome: path.join(scratch, 'rejected'),
            home: scratch,
            url,
            startup: startupBudget(),
            onOpen: () => {},
            onFailure: () => {},
          }),
        ).rejects.toThrow('engine needs an update')
      }
      step = 'close'
      if (native) {
        for (const target of await pages(owner.cdp))
          await owner.cdp.request('Target.closeTarget', { targetId: target.targetId })
      } else {
        await owner.cdp.request('Browser.close')
      }
      await Promise.race([
        owner.exited,
        Bun.sleep(5000).then(() =>
          expect.fail('Closing the app windows did not exit their browser owner'),
        ),
      ])
      await owner.close()
      expect((await fetch(url)).status).toBe(200)
      if (independent?.kind === 'owned') {
        expect(await independent.cdp.request('Browser.getVersion')).toHaveProperty('product')
      }
      expect(failures).toEqual([])
      if (existsSync('/work/tmp/114-g1-evidence')) {
        await mkdir('/work/tmp/114-g1-evidence', { recursive: true })
        await writeFile(
          '/work/tmp/114-g1-evidence/window.png',
          await readFile(path.join(scratch, 'window.png')),
        )
        await writeFile(
          '/work/tmp/114-g1-evidence/smoke.json',
          JSON.stringify(
            {
              executable,
              telemetry,
              normalWindowClose: native,
              independentBrowserSurvived: native,
              rejectedStartupPreservedOtherBrowser: native,
              singleton: native,
              fixtureServicePreserved: true,
            },
            null,
            2,
          ),
        )
      }
    } catch (error) {
      const owner = first?.kind === 'owned' ? first : undefined
      const targets = owner ? await pages(owner.cdp).catch(() => []) : []
      const documents = owner
        ? await Promise.all(
            targets.map(async (target) => ({
              ...target,
              document: await evaluate(
                owner.cdp,
                new Map(),
                target.targetId,
                '({ href: location.href, readyState: document.readyState, titlebar: globalThis.platformBridge?.titlebar, picker: typeof globalThis.platformBridge?.pickEntry })',
              ).catch(() => 'unavailable'),
            })),
          )
        : []
      console.error(
        'smoke failure',
        JSON.stringify({
          condition: step,
          message: (error as { message?: string }).message,
          exits,
          documents,
          telemetry,
          transport: owner?.cdp.snapshot(),
          internal: (error as { internal?: unknown }).internal,
          failures: failures.map((failure) => (failure as { internal?: unknown }).internal),
        }),
      )
      throw error
    } finally {
      if (independent?.kind === 'owned') await independent.close()
      if (second?.kind === 'owned') await second.close()
      if (first?.kind === 'owned') await first.close()
      server.stop(true)
      await rm(scratch, { recursive: true, force: true })
    }
  },
  smokeTimeoutMs,
)

test.skipIf(!executable)(
  'real Chromium waits for the held app response and returns a bridged document',
  async () => {
    const scratch = await mkdtemp(
      path.join(existsSync('/work/tmp') ? '/work/tmp' : tmpdir(), 'polaron-readiness-'),
    )
    const response = Promise.withResolvers<Response>()
    const requested = Promise.withResolvers<void>()
    let owner: ChromiumWindow | undefined
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        requested.resolve()
        return response.promise.then((fixture) => fixture.clone())
      },
    })
    const launch = launchChromium({
      candidate: {
        kind: 'chromium',
        executable: executable!,
        args: ['--headless', '--no-sandbox'],
        confinement: 'none',
        source: 'setting',
        family: 'chromium',
      },
      stateHome: scratch,
      home: scratch,
      url: `http://127.0.0.1:${server.port}/`,
      startup: startupBudget(),
      onOpen: () => {},
      onFailure: () => {},
    }).then((window) => {
      owner = window
      return window
    })
    try {
      expect(
        await Promise.race([launch.then(() => 'ready'), requested.promise.then(() => 'requested')]),
      ).toBe('requested')
      expect(owner).toBeUndefined()
      response.resolve(new Response(fixtureHtml, { headers: { 'Content-Type': 'text/html' } }))
      const window = await launch
      expect(window.kind).toBe('owned')
      if (window.kind !== 'owned') return
      const target = (await pages(window.cdp))[0]!
      expect(
        await evaluate(
          window.cdp,
          new Map(),
          target.targetId,
          'location.href !== "about:blank" && globalThis.platformBridge?.titlebar === "native" && typeof globalThis.platformBridge.pickEntry === "function"',
        ),
      ).toBe(true)
    } finally {
      response.resolve(new Response(fixtureHtml))
      await launch.catch(() => {})
      if (owner?.kind === 'owned') await owner.close()
      server.stop(true)
      await rm(scratch, { recursive: true, force: true })
    }
  },
  smokeTimeoutMs,
)

test(
  'an initial document that never commits fails at the startup cap and reaps its browser',
  async () => {
    const scratch = await mkdtemp(
      path.join(existsSync('/work/tmp') ? '/work/tmp' : tmpdir(), 'polaron-uncommitted-'),
    )
    const pidFile = path.join(scratch, 'pid')
    let observations = 0
    try {
      await expect(
        launchChromium({
          candidate: {
            kind: 'chromium',
            executable: process.execPath,
            args: [
              path.join(import.meta.dirname, 'fixtures/browser.mjs'),
              'uncommitted-page',
              pidFile,
            ],
            confinement: 'none',
            source: 'setting',
            family: 'chromium',
          },
          stateHome: scratch,
          home: scratch,
          url: 'http://localhost:123/',
          startup: startupBudget({
            'window.browserStartupIdleSeconds': 1,
            'window.browserStartupLimitSeconds': 1,
          }),
          observe: () => ({ cpuTicks: ++observations }),
          onOpen: () => {},
          onFailure: () => {},
        }),
      ).rejects.toMatchObject({ internal: { reason: 'startup-limit', startupPhase: 'attach' } })
      const pid = Number(await readFile(pidFile, 'utf8'))
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  },
  smokeTimeoutMs,
)
