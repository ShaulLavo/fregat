import { ok } from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { selectors } from '../selectors'
import { openChat } from './chat-verification'
import { writeSettings } from './native-provider-verification'
import type { Scenario } from './index'

const FIXTURE_ID = 'codex-fixture'
const UPDATED = '99.0.0'

/** A codex at a standalone-installer path: `update` rewrites the version it reports. */
const FAKE_CODEX = `#!/bin/sh
dir=$(dirname "$0")
case "$1" in
  --version) echo "codex-cli $(cat "$dir/version")" ;;
  update) echo run >> "$dir/updates"; sleep 1; echo ${UPDATED} > "$dir/version"; echo "Updated Codex" ;;
  *) exit 1 ;;
esac
`

export const settingsProviderUpdate: Scenario = {
  name: 'settings-provider-update',
  description:
    'Settings › Providers shows each CLI against its latest npm release. The real CLIs show their own update path; a fixture codex at a standalone-installer path updates in one click and reads Up to date after. No real CLI is touched.',
  async run(page, { step }) {
    const base = (await openChat(page)).replace(/\/orchestration$/, '')
    const root = await mkdtemp('/work/tmp/fregat-provider-update-')
    const bin = join(root, 'packages', 'standalone', 'bin')
    try {
      await mkdir(bin, { recursive: true })
      await writeFile(join(bin, 'codex'), FAKE_CODEX)
      await chmod(join(bin, 'codex'), 0o755)
      await writeFile(join(bin, 'version'), '0.1.0\n')
      // This server's state is thrown away after the run.
      await writeSettings(page, base, [
        {
          kind: 'provider.setEnabled',
          providerInstanceId: FIXTURE_ID,
          enabled: true,
          createIfMissing: {
            binaryPath: join(bin, 'codex'),
            config: { home: root },
            displayLabel: 'Codex fixture',
            driverKind: 'codex',
          },
        },
      ])

      await page.goto(page.url().replace(/\/chat(?:\?.*)?$/, '/workbench'))
      await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('providers')
      const fixture = selectors.settingsProviderRow(page, FIXTURE_ID)
      await fixture.getByText('0.1.0 →').waitFor({ timeout: 20_000 })
      await selectors.providerUpdateChecking(page).waitFor({ state: 'detached', timeout: 20_000 })
      await step('versions-read')

      await fixture.getByRole('button', { name: 'Update', exact: true }).click()
      await page.getByText(`Updated Codex fixture to ${UPDATED}`).waitFor({ timeout: 30_000 })
      await fixture.getByText('Up to date').waitFor({ timeout: 10_000 })
      const runs = (await readFile(join(bin, 'updates'), 'utf8')).split('\n').filter(Boolean)
      ok(runs.length === 1, `The update ran once, not ${runs.length} times`)
      await step('fixture-updated')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  },
}
