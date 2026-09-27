import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from 'playwright'
import { strictEqual } from 'node:assert'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { scratchPath } from '../paths'
import { measurePress, pressStampScript, type PressTiming } from '../press-timing'
import { openFileByName, selectors } from '../selectors'
import { sampleEditorPaint } from './prefetch-first-paint'
import type { Scenario } from './index'

const results = new WeakMap<Page, PressTiming[]>()

export const editorTabHoverHighlights: Scenario = {
  name: 'editor-tab-hover-highlights',
  description:
    'Revisit a source tab after short and prolonged hovers and record its first syntax paint.',
  inspect: async (page) => results.get(page) ?? null,
  async run(page, { step }) {
    const fixture = await mkdtemp(scratchPath('fregat-tab-hover-'))
    results.set(page, [])
    try {
      const source = await readFile(
        path.resolve(
          import.meta.dirname,
          '../../../apps/web/src/lib/file-open-intent/state/service.ts',
        ),
        'utf8',
      )
      await writeFile(path.join(fixture, 'target.ts'), `// HOVER_TARGET\n${source}`)
      await writeFile(path.join(fixture, 'other.ts'), 'export const OTHER_FILE = false\n')
      await page.addInitScript(pressStampScript)
      await openFixtureWorkspace(page, fixture)
      await openFileByName(page, 'target.ts')
      await page.waitForFunction(
        `(${sampleEditorPaint({ needle: 'HOVER_TARGET', kind: 'file' })})().colour`,
      )
      await page.waitForTimeout(1200)
      await openFileByName(page, 'other.ts')
      for (const dwell of [0, 2000, 35_000]) {
        const timing = await measureTabHover(page, {
          dwell,
          needle: 'HOVER_TARGET',
          other: selectors.editorTab(page, path.join(fixture.slice(1), 'other.ts')),
          target: selectors.editorTab(page, path.join(fixture.slice(1), 'target.ts')),
        })
        await step(`hover-${dwell}`)
        strictEqual(timing.uncoloredTextFrames, 0, 'Revisited text keeps its syntax colors')
      }
    } finally {
      await releaseFixture(fixture)
    }
  },
}

export const editorTabHoverLive: Scenario = {
  name: 'editor-tab-hover-live',
  description: 'Observe syntax paint while switching between the two reported editor tabs.',
  readOnly: true,
  inspect: async (page) => results.get(page) ?? null,
  async run(page, { step }) {
    results.set(page, [])
    await page.evaluate(pressStampScript)
    const target = selectors.editorTabs(page).filter({ hasText: 'app-runtime-content.tsx' })
    const other = selectors.editorTabs(page).filter({ hasText: 'app-shell.tsx' })
    await target.click()
    await page.waitForTimeout(1500)
    for (const dwell of [0, 2000, 35_000]) {
      const timing = await measureTabHover(page, {
        dwell,
        needle: 'AppRuntimeContent',
        other,
        target,
      })
      await step(`live-hover-${dwell}`)
      strictEqual(timing.uncoloredTextFrames, 0, 'Revisited text keeps its syntax colors')
    }
  },
}

async function measureTabHover(
  page: Page,
  {
    dwell,
    needle,
    other,
    target,
  }: {
    readonly dwell: number
    readonly needle: string
    readonly other: Locator
    readonly target: Locator
  },
) {
  await other.click()
  await page.mouse.move(5, 5)
  await page.waitForTimeout(1000)
  await target.hover()
  await page.waitForTimeout(dwell)
  const timing = await measurePress(
    page,
    `tab hover ${dwell}ms`,
    sampleEditorPaint({ needle, kind: 'file' }),
    async () => {
      await page.mouse.down()
      await page.mouse.up()
    },
  )
  results.get(page)?.push(timing)
  console.log(JSON.stringify(timing))
  return timing
}
