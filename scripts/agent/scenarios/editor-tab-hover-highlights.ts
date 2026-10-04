import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from 'playwright'
import { strictEqual, ok } from 'node:assert'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { scratchPath } from '../paths'
import { measurePress, pressStampScript, type PressTiming } from '../press-timing'
import { openFileByName, selectors, editorTokenPaintSelectors, waitForApp } from '../selectors'
import { recordFrames } from '../blank-frames'
import {
  captureTokenPaint,
  tokenPaintMismatch,
  type TokenPaintObservation,
} from './editor-tab-hover-highlights-probe'
import {
  sampleEditorPaint,
  markdownCoverageSource,
  assertMarkdownCoverage,
} from './prefetch-first-paint'
import type { Scenario } from './index'

const results = new WeakMap<Page, PressTiming[]>()
const tokenFrames = new WeakMap<Page, TokenPaintObservation[]>()

export const editorTabHoverHighlights: Scenario = {
  name: 'editor-tab-hover-highlights',
  description:
    'Revisit a source tab after short and prolonged hovers and record its first syntax paint.',
  inspect: async (page) => ({
    timing: results.get(page) ?? [],
    tokenFrames: tokenFrames.get(page) ?? [],
    missingFacts: [
      'buffer revision',
      'effective provider configuration',
      'session disposal',
      'retained parser and WASM bytes',
    ],
    counters: await page.evaluate(() => ({
      workerRequests: performance.getEntriesByName('editor.worker.request').length,
      syntaxSessionCreatedMarkEvents: performance.getEntriesByName('editor.syntax.session_created')
        .length,
      workerRuntimeSessionIds: [
        ...new Set(
          performance
            .getEntriesByName('editor.worker.request')
            .map<unknown>((entry) => (entry instanceof PerformanceMark ? entry.detail : null))
            .filter(
              (detail): detail is { readonly runtimeSessionId: string } =>
                detail !== null &&
                typeof detail === 'object' &&
                'runtimeSessionId' in detail &&
                typeof detail.runtimeSessionId === 'string',
            )
            .map((detail) => detail.runtimeSessionId),
        ),
      ],
      sharedHighlightGroups: [...CSS.highlights.keys()].filter((name) =>
        name.startsWith('editor-shared-token-'),
      ).length,
    })),
  }),
  async run(page, { step }) {
    const fixture = await mkdtemp(scratchPath('fregat-tab-hover-'))
    results.set(page, [])
    tokenFrames.set(page, [])
    try {
      const source = await readFile(
        path.resolve(
          import.meta.dirname,
          '../../../apps/web/src/lib/file-open-intent/state/service.ts',
        ),
        'utf8',
      )
      const targetSource = `// HOVER_TARGET\n${source}`
      await writeFile(path.join(fixture, 'target.ts'), targetSource)
      await writeFile(
        path.join(fixture, 'hover.md'),
        markdownCoverageSource('MARKFILEhover.md') + '\n[coverage-ref]: /eof\n',
      )
      await writeFile(path.join(fixture, 'other.ts'), 'export const OTHER_FILE = false\n')
      await page.addInitScript(pressStampScript)
      await openFixtureWorkspace(page, fixture)
      const tracedUrl = new URL(page.url())
      tracedUrl.searchParams.set('editorPerfTrace', '1')
      await page.goto(tracedUrl.href)
      await waitForApp(page)
      await openFileByName(page, 'target.ts')
      await page.waitForFunction(
        `(${sampleEditorPaint({ needle: 'HOVER_TARGET', kind: 'file' })})().colour`,
      )
      await page.waitForTimeout(1200)
      const reference = await page.evaluate(captureTokenPaint, {
        ...editorTokenPaintSelectors,
        source: targetSource,
      })
      const observation: TokenPaintObservation = {
        ...reference,
        identity: {
          document: path.join(fixture, 'target.ts'),
          revision: null,
          configuration: 'unavailable',
        },
      }
      strictEqual(
        tokenPaintMismatch(observation, observation),
        null,
        'Settled reference maps every visible source row',
      )
      tokenFrames.get(page)?.push(observation)
      await openFileByName(page, 'other.ts')
      for (const dwell of [0, 200, 2000, 35_000]) {
        const frames = await measureCompleteTabPaint(page, {
          dwell,
          source: targetSource,
          reference: observation,
          other: selectors.editorTab(page, path.join(fixture.slice(1), 'other.ts')),
          target: selectors.editorTab(page, path.join(fixture.slice(1), 'target.ts')),
        })
        tokenFrames.get(page)?.push(...frames)
        await step(`hover-${dwell}`)
        for (const frame of frames)
          strictEqual(
            tokenPaintMismatch(frame, observation),
            null,
            'Every visible token matches its settled source offsets and styles',
          )
      }
      await openFileByName(page, 'hover.md')
      await assertMarkdownCoverage(page, 'MARKFILEhover.md')
      for (const dwell of [0, 2000, 35_000]) {
        const timing = await measureTabHover(page, {
          dwell,
          needle: 'MARKFILEhover.md',
          other: selectors.editorTab(page, path.join(fixture.slice(1), 'other.ts')),
          target: selectors.editorTab(page, path.join(fixture.slice(1), 'hover.md')),
        })
        await assertMarkdownCoverage(page, 'MARKFILEhover.md')
        await step(`markdown-hover-${dwell}`)
        strictEqual(
          timing.previewMs,
          timing.textMs,
          'Revisited Markdown paints complete preview with its first text frame',
        )
        strictEqual(
          timing.uncoloredTextFrames,
          0,
          'Revisited Markdown keeps complete syntax coverage',
        )
      }
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function measureCompleteTabPaint(
  page: Page,
  {
    dwell,
    source,
    reference,
    other,
    target,
  }: {
    readonly dwell: number
    readonly source: string
    readonly reference: TokenPaintObservation
    readonly other: Locator
    readonly target: Locator
  },
): Promise<TokenPaintObservation[]> {
  await other.click()
  await page.mouse.move(5, 5)
  await target.hover()
  if (dwell > 0) await page.waitForTimeout(dwell)
  const sampler = `() => {
    const frame = (${captureTokenPaint.toString()})(${JSON.stringify({ ...editorTokenPaintSelectors, source })})
    return { ...frame, targetVisible: frame.rows.some(row => row.text.includes('HOVER_TARGET')) }
  }`
  const frames = await recordFrames<TokenPaintObservation & { readonly targetVisible: boolean }>(
    page,
    sampler,
    async () => {
      await target.click()
      await page.waitForFunction(
        'window.__agentFrameRecorder.frames.some(frame => frame.targetVisible)',
        null,
        { timeout: 10_000 },
      )
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
    },
  )
  const visible = frames.filter((frame) => frame.targetVisible)
  ok(visible.length > 0, 'At least one target text frame was observed')
  return visible.map((frame) => ({ ...frame, identity: reference.identity }))
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
