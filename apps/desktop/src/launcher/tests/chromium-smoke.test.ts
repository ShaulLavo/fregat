import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { launchChromium, type ChromiumWindow } from '../chromium'
import type { CdpClient } from '../cdp'
import type { BrowserCandidate } from '../browser'

const executable =
  Bun.which('chromium') ?? Bun.which('google-chrome') ?? Bun.which('google-chrome-stable')
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
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await check()) return
    await Bun.sleep(50)
  }
  expect.fail('Fixture browser condition timed out')
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
    const native = Boolean(process.env.WAYLAND_DISPLAY || process.env.DISPLAY)
    const telemetry: Record<string, unknown>[] = []
    const failures: unknown[] = []
    let step = 'launch'
    const exits: unknown[] = []
    try {
      // CI has no compositor; its browser still exercises the production CDP pipe and profile.
      if (!native) candidate.args = ['--headless', '--no-sandbox']
      first = await launchChromium({
        candidate,
        stateHome: scratch,
        home: scratch,
        url,
        onOpen: (event) => telemetry.push(event),
        onExit: (exit) => exits.push(exit),
        onFailure: (error) => failures.push(error),
      })
      expect(first.kind).toBe('owned')
      if (first.kind !== 'owned') return
      const owner = first
      const sessions = new Map<string, string>()
      await until(async () => {
        const targets = await pages(owner.cdp)
        if (!targets[0]) return false
        return Boolean(
          await evaluate(
            owner.cdp,
            sessions,
            targets[0].targetId,
            'globalThis.platformBridge?.titlebar === "native" && !globalThis.platformBridge.pickEntry',
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
      await until(async () => (await pages(owner.cdp)).length === 2)
      for (const target of await pages(owner.cdp)) {
        await until(async () =>
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
          onOpen: () => {},
          onExit: (exit) => exits.push({ second: true, ...exit }),
          onFailure: (error) => failures.push(error),
        })
        expect(second.kind).toBe('handoff')
        await until(async () => (await pages(owner.cdp)).length === 3)
        for (const target of await pages(owner.cdp)) {
          await until(async () =>
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
      await until(async () => telemetry.length > 0)
      expect(telemetry[0]).toMatchObject({ engine: 'chromium' })
      expect(telemetry[0]!.rafPerSecond).toBeGreaterThan(0)
      if (native) {
        step = 'independent-owner'
        independent = await launchChromium({
          candidate,
          stateHome: path.join(scratch, 'independent'),
          home: scratch,
          url,
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
      console.error(
        'smoke failure',
        step,
        exits,
        step,
        (error as { internal?: unknown }).internal,
        failures.map((failure) => (failure as { internal?: unknown }).internal),
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
  30_000,
)
