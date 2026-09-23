import { fixtureGit, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { strictEqual } from 'node:assert'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { openFileFromTree, runPaletteCommand, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

const source = `export function alphaRegion() {
  return 'alpha'
}

export function betaRegion() {
  return 'beta'
}
`

export const editorSplitBreadcrumbs: Scenario = {
  name: 'editor-split-breadcrumbs',
  description: 'Keep each split view’s symbol breadcrumbs attached to its own cursor.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-split-breadcrumbs-')
    const originalUrl = page.url()
    try {
      await writeFile(path.join(fixture, 'regions.ts'), source)
      await writeFile(
        path.join(fixture, 'other.ts'),
        "export function gammaRegion() {\n  return 'gamma'\n}\n",
      )
      await writeFile(path.join(fixture, 'README.md'), '# Breadcrumb check\n\nPlain text.\n')
      await fixtureGit(fixture, ['init', '--quiet'])
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, [
        '-c',
        'user.name=Breadcrumb verification',
        '-c',
        'user.email=breadcrumbs@example.invalid',
        'commit',
        '--quiet',
        '-m',
        path.basename(fixture),
      ])
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'regions.ts')
      await setCursorLine(page, 0, 1)
      await symbol(page, 0, 'alphaRegion').waitFor({ timeout: 30_000 })
      await step('source-alpha-scope')

      await runPaletteCommand(page, 'Split Editor Right')
      await selectors.editorGroupInput(page, 1).waitFor()
      await setCursorLine(page, 1, 5)
      await symbol(page, 1, 'betaRegion').waitFor()
      await step('same-file-independent-scopes')
      strictEqual(
        await symbol(page, 0, 'alphaRegion').count(),
        1,
        'left view keeps its own alpha cursor scope',
      )
      strictEqual(
        await symbol(page, 0, 'betaRegion').count(),
        0,
        'right cursor does not replace left breadcrumbs',
      )

      await selectors.editorGroupInput(page, 0).focus()
      await symbol(page, 0, 'alphaRegion').waitFor()
      strictEqual(
        await symbol(page, 1, 'betaRegion').count(),
        1,
        'focus changes preserve both cursor scopes',
      )
      await step('left-focus-keeps-right-scope')

      await selectors.editorGroupInput(page, 1).focus()
      await openFileFromTree(page, 'other.ts')
      await setCursorLine(page, 1, 1)
      await symbol(page, 1, 'gammaRegion').waitFor({ timeout: 30_000 })
      strictEqual(
        await symbol(page, 0, 'alphaRegion').count(),
        1,
        'inactive file retains symbol breadcrumbs',
      )
      await step('different-files-keep-scopes')

      await openFileFromTree(page, 'README.md')
      await setCursorLine(page, 1, 1)
      await step('switch-to-file-without-symbols')
      strictEqual(
        await symbol(page, 1, 'gammaRegion').count(),
        0,
        'a file without symbols never retains the previous file’s scope',
      )
      strictEqual(await symbol(page, 0, 'alphaRegion').count(), 1)
    } finally {
      await page.goto(originalUrl)
      await waitForApp(page)
      await releaseFixture(fixture)
    }
  },
}

function symbol(page: Page, index: number, name: string) {
  return selectors.editorGroupBreadcrumbs(page, index).getByRole('button', { name, exact: true })
}

async function setCursorLine(page: Page, index: number, line: number) {
  await selectors.editorGroupInput(page, index).focus()
  await page.keyboard.press('Control+Home')
  for (let row = 0; row < line; row += 1) await page.keyboard.press('ArrowDown')
}
