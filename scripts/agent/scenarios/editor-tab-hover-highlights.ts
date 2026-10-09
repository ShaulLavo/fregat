import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from 'playwright'
import { strictEqual, ok } from 'node:assert'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { scratchPath } from '../paths'
import { measurePress, pressStampScript, type PressTiming } from '../press-timing'
import {
  openFileByName,
  selectors,
  editorTokenPaintSelectors,
  waitForApp,
  editorTokenActivationSelectors,
} from '../selectors'
import { recordFrames } from '../blank-frames'
import {
  captureTokenPaint,
  tokenPaintMismatch,
  tokenPaintHandoff,
  resolveTokenPaintRuns,
  type TokenPaintReference,
  type TokenPaintHandoff,
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
const handoffs = new WeakMap<Page, TokenPaintHandoff[]>()

export const editorTabHoverHighlights: Scenario = {
  name: 'editor-tab-hover-highlights',
  description:
    'Revisit a source tab after short and prolonged hovers and record its first syntax paint.',
  inspect: async (page) => ({
    timing: results.get(page) ?? [],
    tokenFrames: tokenFrames.get(page) ?? [],
    handoffs: handoffs.get(page) ?? [],
    activationEvidence: 'selected tab resource; installed DOM generation unknown',
    acceptanceGaps: [
      'held subject after activation',
      'folded rows',
      'wrapped rows',
      'saved presentation',
    ],
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
    handoffs.set(page, [])
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
      const targetDocument = path.join(fixture.slice(1), 'target.ts')
      const reference = await settledSourceReference(page, targetSource, targetDocument)
      const observation = await sampleCurrentSubject(page, targetSource)
      tokenFrames.get(page)?.push(observation)
      strictEqual(
        tokenPaintMismatch(observation, reference),
        null,
        'Settled DOM matches the complete real-worker source',
      )
      await openFileByName(page, 'other.ts')
      for (const dwell of [0, 200, 2000, 35_000]) {
        const frames = await measureCompleteTabPaint(page, {
          dwell,
          source: targetSource,
          reference,
          heldSource: 'export const OTHER_FILE = false\n',
          heldDocument: path.join(fixture.slice(1), 'other.ts'),
          other: selectors.editorTab(page, path.join(fixture.slice(1), 'other.ts')),
          target: selectors.editorTab(page, path.join(fixture.slice(1), 'target.ts')),
        })
        await step(`hover-${dwell}`)
        for (const frame of frames)
          strictEqual(
            frame.mismatch,
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

function subjectSampler(source: string): string {
  return `() => {
    const frame = (${captureTokenPaint.toString()})(${JSON.stringify({ ...editorTokenPaintSelectors, source })})
    const viewport = document.querySelector(${JSON.stringify(editorTokenPaintSelectors.viewportSelector)})
    const group = viewport?.closest(${JSON.stringify(editorTokenActivationSelectors.group)})
    const selected = group?.querySelector(${JSON.stringify(editorTokenActivationSelectors.selectedTab)})
    return { ...frame, identity: { document: selected?.getAttribute('data-editor-tab-path') ?? null, revision: null, configuration: 'unknown', paintedGeneration: 'unknown' } }
  }`
}

async function sampleCurrentSubject(page: Page, source: string): Promise<TokenPaintObservation> {
  return page.evaluate(`(${subjectSampler(source)})()`)
}

async function settledSourceReference(
  page: Page,
  source: string,
  document: string,
): Promise<TokenPaintReference> {
  // Resolved by Vite like the app's own imports, so the provider and analysis share one module graph.
  const coreUrl = '/@id/@singapore-editor/core/document'
  const editorUrl = '/@id/@singapore-editor/core/editor'
  const tokens = await page.evaluate<
    Parameters<typeof resolveTokenPaintRuns>[0]['tokens']
  >(`(async () => {
    const core = await import(${JSON.stringify(coreUrl)})
    const editor = await import(${JSON.stringify(editorUrl)})
    const syntax = await import('/src/features/editor/state/syntax-highlighting.ts')
    const buffer = core.createEditorTextBuffer(${JSON.stringify(source)})
    const analysis = editor.createEditorDocumentAnalysis({ buffer, documentId: 'observer-reference' })
    const session = analysis.borrowHighlighter({ provider: syntax.editorHighlighterProvider(), languageId: 'typescript' })
    if (!session) throw new RangeError('reference worker unavailable')
    try {
      const result = await session.refresh(buffer.getTextSnapshot())
      return result.tokens.toTokens()
    } finally {
      session.dispose()
      analysis.dispose()
    }
  })()`)
  const runs = await page.evaluate(resolveTokenPaintRuns, {
    source,
    tokens,
    viewportSelector: editorTokenPaintSelectors.viewportSelector,
  })
  return {
    source,
    runs,
    expected: 'colored',
    identity: { document, revision: null, configuration: 'unknown', paintedGeneration: 'unknown' },
  }
}

async function measureCompleteTabPaint(
  page: Page,
  {
    dwell,
    source,
    reference,
    heldSource,
    heldDocument,
    other,
    target,
  }: {
    readonly dwell: number
    readonly source: string
    readonly reference: TokenPaintReference
    readonly heldSource: string
    readonly heldDocument: string
    readonly other: Locator
    readonly target: Locator
  },
): Promise<TokenPaintHandoff[]> {
  await other.click()
  const held = await settledSourceReference(page, heldSource, heldDocument)
  const sampler = `() => {
    const current = (${subjectSampler(source)})()
    if (current.identity.document !== ${JSON.stringify(heldDocument)}) return current
    return (${subjectSampler(heldSource)})()
  }`
  await page.mouse.move(5, 5)
  await target.hover()
  if (dwell > 0) await page.waitForTimeout(dwell)
  const activationErrors: unknown[] = []
  const frames = await recordFrames<TokenPaintObservation>(page, sampler, async () => {
    try {
      await target.click()
      await page.waitForFunction(
        `document.querySelector(${JSON.stringify(editorTokenActivationSelectors.selectedTab)})?.getAttribute('data-editor-tab-path') === ${JSON.stringify(reference.identity.document)}`,
        null,
        { timeout: 10_000 },
      )
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
    } catch (error) {
      activationErrors.push(error)
    }
  })
  tokenFrames.get(page)?.push(...frames)
  const classified = tokenPaintHandoff(frames, held, reference)
  handoffs.get(page)?.push(...classified)
  if (activationErrors.length > 0) throw activationErrors[0]
  ok(
    classified.some((sample) => sample.subject === 'requested'),
    'Target activation was observed independently of text and tokens',
  )
  return classified
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
