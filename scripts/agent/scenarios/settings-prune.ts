import { ok } from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { selectors } from '../selectors'
import type { Scenario } from './index'

const NOTICE = 'Window frost was replaced by Window material.'

export const settingsPrune: Scenario = {
  name: 'settings-prune',
  description:
    'Remove an old setting from the app-owned file, show one info notice, and keep it gone after reloading.',
  requiresIsolatedServer: true,
  async run(page, { server, step }) {
    ok(server, 'This scenario needs its throwaway settings home')
    const file = path.join(server.home, 'settings.json')
    const settings = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...settings, 'window.frost': true }))
    await selectors.toast(page, NOTICE).waitFor()
    const cleaned = JSON.parse(await readFile(file, 'utf8'))
    ok(!Object.hasOwn(cleaned, 'window.frost'), 'The retired setting was removed on disk')
    ok(!Object.hasOwn(cleaned, 'window.material'), 'The old value was never migrated')
    await step('removed-setting-info')
    await selectors.toast(page, NOTICE).waitFor({ state: 'hidden', timeout: 15_000 })
    await page.reload()
    await selectors.windowToolbar(page).waitFor()
    ok((await selectors.toast(page, NOTICE).count()) === 0, 'Reload does not repeat the notice')
    await step('reload-without-notice')
  },
}
