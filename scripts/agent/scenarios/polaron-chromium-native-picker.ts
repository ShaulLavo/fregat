import { ok, strictEqual } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nativeBudget } from '../../../apps/desktop/src/launcher/native-helper'
import { nativeHostBinary } from '../../../apps/desktop/src/launcher/native-window'
import {
  chooseFixtureFolder,
  createGitFixture,
  fixtureGit,
  releaseFixture,
} from '../fixture-workspace'
import { openPolaronFixtureWindow } from '../polaron-window'
import { observePolaronTerminal } from '../polaron-continuity'
import { polaronNativeSelectors } from '../selectors'
import { isPrivateDisplayRuntime } from '../polaron-display-env'
import type { Scenario } from './index'

export const polaronChromiumNativePicker: Scenario = {
  name: 'polaron-chromium-native-picker',
  description:
    'Exercise the real Chromium app folder command, native helper timeout guidance and retained shell using CDP pixels.',
  requiresIsolatedServer: true,
  async run(page, { step, evidence, file }) {
    const fixture = await createGitFixture('polaron-chromium-picker')
    const continuity = await observePolaronTerminal(page)
    let current: Awaited<ReturnType<typeof openPolaronFixtureWindow>> | undefined
    try {
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await chooseFixtureFolder(page, fixture)
      const nativeExecutable = nativeHostBinary(path.resolve(import.meta.dirname, '../../..'))
      const binary =
        isPrivateDisplayRuntime(path.dirname(file)) && path.basename(file) === 'native-picker'
          ? file
          : nativeExecutable
      current = await openPolaronFixtureWindow(
        page,
        path.join(fixture, 'native-picker'),
        evidence,
        {
          headless: true,
          native: { binary, budget: nativeBudget({ 'window.nativeDialogTimeoutSeconds': 2 }) },
        },
      )
      const window = current
      const evaluate = async (expression: string) => {
        const result = await window.cdp.request(
          'Runtime.evaluate',
          { expression, returnByValue: true },
          window.session,
        )
        return (result.result as { value?: unknown }).value
      }
      const facts = await evaluate(polaronNativeSelectors.bridgeFacts)
      strictEqual((facts as { picker: string }).picker, 'function')
      strictEqual((facts as { capture: boolean }).capture, true)
      const requests = new Map<string, { method: string; mode: string }>()
      let bindingFrames = 0
      const detach = window.cdp.on('Runtime.bindingCalled', (event) => {
        if (event.params.name !== 'platformShellCall' || typeof event.params.payload !== 'string')
          return
        const value = JSON.parse(event.params.payload)
        if (value.method === 'pickEntry') {
          bindingFrames++
          requests.set(`${value.documentId}:${value.id}`, {
            method: value.method,
            mode: value.options?.mode,
          })
        }
      })
      try {
        await evaluate(polaronNativeSelectors.openProjectMenu)
        await Bun.sleep(100)
        await evaluate(polaronNativeSelectors.openFolderMenu)
        const deadline = Date.now() + 5000
        let pid: number | undefined
        while (!pid && Date.now() < deadline) {
          pid = ownedPicker(nativeExecutable)
          if (!pid) await Bun.sleep(25)
        }
        ok(pid, 'The actual folder command starts the owned native picker helper')
        const identity = observe(pid)
        ok(identity, 'The owned helper exposes its process identity')
        let guided = false
        while (Date.now() < deadline) {
          guided = (await evaluate(polaronNativeSelectors.pickerError)) === true
          if (guided && !observe(pid)) break
          await Bun.sleep(50)
        }
        ok(guided, 'The helper timeout replies through the bridge into app error guidance')
        ok(!observe(pid), 'The bounded native picker helper is reaped')
        strictEqual(requests.size, 1)
        await evidence.json('chromium-native-picker.json', {
          facts,
          requests: [...requests.values()],
          bindingFrames,
          pid,
          identity,
          helperReaped: true,
          timeoutGuidance: true,
          pixels: 'headless CDP',
          paintedSuccessCancel: 'OWNER-ONLY',
        })
        await window.cdp.request('Page.bringToFront', {}, window.session)
        await window.cdp.request(
          'Runtime.evaluate',
          { expression: polaronNativeSelectors.settledPickerError, awaitPromise: true },
          window.session,
        )
        const image = await window.cdp.request(
          'Page.captureScreenshot',
          { format: 'png' },
          window.session,
        )
        await evidence.write(
          'chromium-native-picker.png',
          Buffer.from(image.data as string, 'base64'),
        )
        await continuity.afterNative('CHROMIUM_NATIVE_PICKER', () => window.close())
        await step('shared-terminal-survives-chromium-native-picker')
      } finally {
        detach()
      }
      current = undefined
    } finally {
      await current?.close()
      await page.goto('about:blank')
      await continuity.dispose()
      await releaseFixture(fixture)
    }
  },
}

function ownedPicker(binary: string) {
  const children = readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8')
    .trim()
    .split(/\s+/)
    .map(Number)
  return children.find((pid) => {
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
      return args[0] === binary && args[1] === 'pick'
    } catch {
      return false
    }
  })
}

function observe(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')
    return { state: fields[0], startTime: fields[19] }
  } catch {
    return null
  }
}
