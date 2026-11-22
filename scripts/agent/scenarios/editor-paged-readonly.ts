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
    'Open a sparse 300 MiB file read-only, browse bounded sections, jump by byte, and close the read session.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp(scratchPath('fregat-paged-'))
    const target = path.join(fixture, 'large.txt')
    const lines = Array.from({ length: 4096 }, (_, index) => `Paged fixture line ${index + 1}\n`)
    const requestedStarts: number[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (request.method() === 'GET' && url.pathname.includes('/fs/read-session/'))
        requestedStarts.push(Number(url.searchParams.get('start')))
    })
    try {
      await writeFile(target, lines.join(''))
      await writeFile(path.join(fixture, 'other.txt'), 'another file')
      await truncate(target, 300 * 1024 * 1024)
      await openFixtureWorkspace(page, fixture)
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).fill('large.txt')
      await selectors.commandOption(page, 'large.txt').click()
      await selectors.openReadOnly(page).waitFor({ timeout: 15_000 })
      await step('oversized-file-offers-read-only')
      const readsBeforeOpen = requestedStarts.length
      await selectors.openReadOnly(page).click()
      await selectors
        .pagedContents(page)
        .getByText('Paged fixture line 1', { exact: true })
        .waitFor({ timeout: 15_000 })
      await step('first-page')
      strictEqual(requestedStarts.length - readsBeforeOpen, 1, 'Opening reads one viewer range')
      await selectors.pagedNext(page).click()
      await selectors
        .pagedContents(page)
        .getByText('Paged fixture line 129', { exact: true })
        .waitFor()
      await selectors.pagedPrevious(page).click()
      await selectors
        .pagedContents(page)
        .getByText('Paged fixture line 1', { exact: true })
        .waitFor()
      const readsBeforeJump = requestedStarts.length
      await selectors.pagedByte(page).fill(String(Buffer.byteLength(lines.slice(0, 2999).join(''))))
      await selectors.pagedGo(page).click()
      await selectors
        .pagedContents(page)
        .getByText('Paged fixture line 3000', { exact: true })
        .waitFor()
      const jumpReads = requestedStarts.slice(readsBeforeJump)
      ok(jumpReads.length > 0 && jumpReads.every((start) => start > 0), 'The jump skips the prefix')
      const readsBeforeCopy = requestedStarts.length
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await selectors.pagedCopy(page).click()
      await page.getByText('Copied displayed text', { exact: true }).waitFor()
      const copied = await page.evaluate(() => navigator.clipboard.readText())
      strictEqual(copied, lines.slice(2999, 2999 + 128).join(''))
      strictEqual(requestedStarts.length, readsBeforeCopy, 'Copy reads only the mounted window')
      await step('byte-jump-and-bounded-copy')
      await Promise.all([
        page.waitForRequest(
          (request) => request.method() === 'DELETE' && request.url().includes('/fs/read-session/'),
        ),
        openFileByName(page, 'other.txt'),
      ])
    } finally {
      await page.goto(originalUrl)
      await releaseFixture(fixture)
    }
  },
}
