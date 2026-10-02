import { ok, strictEqual, rejects } from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  spawnHost,
  nativeBudget,
  type HostProcess,
} from '../../../apps/desktop/src/launcher/native-helper'
import {
  launchWebview,
  nativeHostBinary,
  showStartFailure,
} from '../../../apps/desktop/src/launcher/native-window'
import { launcherErrors } from '../../../apps/desktop/src/launcher/structured-errors'
import { startupBudget } from '../../../apps/desktop/src/launcher/startup'
import {
  chooseFixtureFolder,
  createGitFixture,
  fixtureGit,
  releaseFixture,
} from '../fixture-workspace'
import { proveNativeLauncherRelease } from '../native-launcher-release'
import { observeTerminalContinuity } from '../terminal-continuity'
import { isPrivateDisplayRuntime } from '../desktop-display-env'
import { nativeHostSelectors } from '../selectors'
import type { Scenario } from './index'

export const nativeHost: Scenario = {
  name: 'native-host',
  description:
    'Open real WebKitGTK fixture windows and preserve the existing shell across native host close, crash and launcher termination.',
  requiresIsolatedServer: true,
  async run(page, { step, evidence }) {
    // NOT-PORTABLE: Requires the private Hyprland proof display and a built native host.
    const runtime = process.env.XDG_RUNTIME_DIR
    const signature = process.env.HYPRLAND_INSTANCE_SIGNATURE
    ok(runtime, 'The private display runtime is required')
    ok(
      isPrivateDisplayRuntime(runtime) && signature,
      'Native captures need a proof-owned display runtime and instance',
    )
    const metadata = JSON.parse(readFileSync(path.join(runtime, 'desktop-proof.json'), 'utf8'))
    strictEqual(metadata.signature, signature)
    ok(
      existsSync(path.join(runtime, 'hypr', signature, '.socket.sock')),
      'The selected control socket belongs to the proof',
    )
    await evidence.json('native-display.json', metadata)
    const fixture = await createGitFixture('native-host')
    const continuity = await observeTerminalContinuity(page)
    const native = nativeHostBinary(path.resolve(import.meta.dirname, '../../..'))
    let current: Awaited<ReturnType<typeof launchWebview>> | undefined
    try {
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await chooseFixtureFolder(page, fixture)
      const serverUrl = await page.evaluate(
        () => (window as Window & { platformDevServerUrl?: string }).platformDevServerUrl,
      )
      ok(serverUrl, 'The native window uses the throwaway API')
      for (const action of ['close', 'crash'] as const) {
        let process: HostProcess | undefined
        let facts: unknown
        const frames: unknown[] = []
        current = await launchWebview({
          binary: native,
          url: page.url(),
          budget: nativeBudget({
            'window.nativeDialogTimeoutSeconds': action === 'close' ? 1 : 300,
          }),
          startup: startupBudget(),
          initialScript: `window.platformDevServerUrl=${JSON.stringify(serverUrl)};sessionStorage.setItem('fregat.terminal-namespace',${JSON.stringify(`native-${action}-`)});`,
          spawn: (args) => {
            process = spawnHost(args)
            return process
          },
          onOpen: (value) => frames.push(value),
          onMessage: (body) => {
            if (typeof body === 'object' && body && 'nativeProof' in body) facts = body.nativeProof
          },
        })
        const deadline = Date.now() + 20_000
        while (Date.now() < deadline) {
          current.host.evaluate(
            `webkit.messageHandlers.platformShell.postMessage({nativeProof:(${nativeHostSelectors.readiness})})`,
          )
          await page.waitForTimeout(100)
          if (facts && (facts as { ready: boolean }).ready && frames.length) break
        }
        await evidence.json(`webkit-${action}-readiness.json`, { facts, frames })
        ok(
          facts && (facts as { ready: boolean }).ready,
          'Actual Platform renders in the native host',
        )
        strictEqual((facts as { capture: boolean }).capture, false)
        strictEqual((facts as { picker: string }).picker, 'function')
        if (action === 'close') {
          const window = current
          await continuity.afterNative('NATIVE_PICKER_TIMEOUT', async () => {
            await rejects(window.host.pick({ mode: 'folder' }), {
              code: 'desktop.webview.PICKER_TIMEOUT',
            })
            const reopened = rejects(window.host.pick({ mode: 'folder' }), {
              code: 'desktop.webview.PICKER_TIMEOUT',
            })
            await page.waitForTimeout(300)
            strictEqual(
              Bun.spawnSync(['grim', evidence.file('webkit-reopened-chooser.png')]).exitCode,
              0,
            )
            await reopened
            facts = undefined
            window.host.evaluate(
              `webkit.messageHandlers.platformShell.postMessage({nativeProof:(${nativeHostSelectors.readiness})})`,
            )
            const timeoutDeadline = Date.now() + 5000
            while (!facts && Date.now() < timeoutDeadline) await page.waitForTimeout(50)
            ok(facts && (facts as { ready: boolean }).ready, 'The app survives chooser timeout')
          })
          await evidence.json('webkit-picker-timeout.json', {
            code: 'desktop.webview.PICKER_TIMEOUT',
            windowRetained: true,
            chooserAttempts: 2,
            facts,
          })
          await step('shared-terminal-survives-native-picker-timeout')
        }
        const capture = Bun.spawnSync(['grim', evidence.file(`webkit-${action}.png`)])
        strictEqual(capture.exitCode, 0, 'The proof-owned compositor captures the native app')
        const window = current
        await continuity.afterNative(`NATIVE_${action.toUpperCase()}`, async () => {
          if (action === 'close') await window.close()
          else process!.kill('SIGKILL')
          await window.exited.catch(() => {})
        })
        await step(`shared-terminal-survives-native-${action}`)
        current = undefined
      }
      const controller = new AbortController()
      const message = showStartFailure(
        launcherErrors.LAUNCH_FAILED({ internal: { reason: 'fixture-startup-failure' } }),
        { binary: native, signal: controller.signal },
      )
      try {
        await page.waitForTimeout(700)
        const capture = Bun.spawnSync(['grim', evidence.file('native-startup-message.png')])
        strictEqual(capture.exitCode, 0)
      } finally {
        controller.abort()
        await message.catch(() => {})
      }
      for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
        await continuity.afterNative(`NATIVE_LAUNCHER_${signal}`, () =>
          proveNativeLauncherRelease(page, fixture, native, serverUrl, signal, evidence),
        )
        await step(`shared-terminal-survives-native-launcher-${signal}`)
      }
      await evidence.json('native-host-verdict.json', {
        readyBridge: true,
        displayCapture: false,
        retainedShellAfterNativeClose: true,
        retainedShellAfterNativeCrash: true,
        pickerInteraction: 'OWNER-ONLY: painted native chooser success and cancel',
        launcherTermination: ['SIGTERM', 'SIGKILL'],
      })
    } finally {
      await current?.close()
      await page.goto('about:blank')
      await continuity.dispose()
      await releaseFixture(fixture)
    }
  },
}
