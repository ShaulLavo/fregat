import { strictEqual, ok } from 'node:assert/strict'
import { mkdtemp, truncate, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { scratchPath } from '../paths'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { chords, selectors, openFileByName } from '../selectors'

export const editorPagedReadonly: Scenario = {
  name: 'editor-paged-readonly',
  description:
    'Open a sparse 300 MiB file read-only, navigate global lines, copy one section, and release the read session.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp(scratchPath('fregat-paged-'))
    const target = path.join(fixture, 'large.txt')
    const released: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'DELETE' && request.url().includes('/fs/read-session/'))
        released.push(request.url())
    })
    try {
      await writeFile(
        target,
        Array.from({ length: 4096 }, (_, index) => `Paged fixture line ${index + 1}\n`).join(''),
      )
      await writeFile(path.join(fixture, 'other.txt'), 'another file')
      await truncate(target, 300 * 1024 * 1024)
      await openFixtureWorkspace(page, fixture)
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).fill('large.txt')
      await selectors.commandOption(page, 'large.txt').click()
      await selectors.openReadOnly(page).waitFor({ timeout: 15_000 })
      await step('oversized-file-offers-read-only')
      await selectors.openReadOnly(page).click()
      await selectors
        .pagedContents(page)
        .getByText('Paged fixture line 1', { exact: true })
        .waitFor({ timeout: 15_000 })
      await step('first-page')
      await selectors.pagedNext(page).click()
      await selectors
        .pagedContents(page)
        .getByText('Paged fixture line 129', { exact: true })
        .waitFor()
      await selectors.pagedLine(page).fill('3000')
      await selectors.pagedGo(page).click()
      await selectors
        .pagedContents(page)
        .getByText('Paged fixture line 3000', { exact: true })
        .waitFor()
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await selectors.pagedCopy(page).click()
      const copied = await page.evaluate(() => navigator.clipboard.readText())
      strictEqual(copied.split('\n').length, 128)
      ok(copied.startsWith('Paged fixture line 3000\n'))
      await step('global-line-jump-and-bounded-copy')
      await openFileByName(page, 'other.txt')
      await page.waitForTimeout(500)
      ok(released.length > 0, 'Leaving the viewer closes its server read session')
    } finally {
      await page.goto(originalUrl)
      await releaseFixture(fixture)
    }
  },
}
