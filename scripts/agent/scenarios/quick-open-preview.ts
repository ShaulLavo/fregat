import { ok, strictEqual, throws } from 'node:assert/strict'
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { JSHandle } from 'playwright'
import {
  openFixtureWorkspace,
  releaseFixture,
  createGitFixture,
  fixtureGit,
} from '../fixture-workspace'
import { captureScenarioFailure } from '../scenario-failure'
import {
  captureFilePreviewFrame,
  filePreviewFrameFacts,
  filePreviewIdentityFacts,
  focusEditor,
  chords,
  selectors,
  type FilePreviewFrame,
} from '../selectors'
import type { Scenario } from './index'

const liveName = 'native-preview-live.txt'
const diskName = 'native-preview-disk.txt'

export const quickOpenPreview: Scenario = {
  name: 'quick-open-preview',
  description:
    'Retain the edited preview through a real palette interest, cancel a pending disk capture, then explicitly open the complete file.',
  requiresIsolatedServer: true,
  async run(page, context) {
    const { step, evidence } = context
    const fixture = await createGitFixture('native-preview')
    const livePath = path.join(fixture, liveName).slice(1)
    const diskPath = path.join(fixture, 'cold', diskName).slice(1)
    const original = 'DISK_A\n' + 'bounded source 😀\n'.repeat(10_000)
    const disk = 'DISK_B\n' + 'whole disk source\n'.repeat(10_000) + 'END_B\n'
    const counts = { liveHead: 0, liveFull: 0, diskHead: 0, diskFull: 0 }
    const requests: { url: string; route: string; target: string; phase: string }[] = []
    const handles: JSHandle<FilePreviewFrame | null>[] = []
    let primary: { error: unknown } | null = null
    let fixtureReleased = false
    let phase = 'initial-full-open'
    let releaseHead = () => {}
    const request = (item: import('playwright').Request) => {
      const url = new URL(item.url())
      const target = url.searchParams.get('path') ?? ''
      const route = url.pathname
      if (target !== livePath && target !== diskPath) return
      if (!route.endsWith('/fs/head') && !route.endsWith('/fs/read')) return
      requests.push({ url: item.url(), target, route, phase })
      if (target === livePath && route.endsWith('/fs/head')) counts.liveHead++
      if (target === livePath && route.endsWith('/fs/read')) counts.liveFull++
      if (target === diskPath && route.endsWith('/fs/head')) counts.diskHead++
      if (target === diskPath && route.endsWith('/fs/read')) counts.diskFull++
    }
    try {
      page.on('request', request)
      await writeFile(path.join(fixture, liveName), original)
      await mkdir(path.join(fixture, 'cold'))
      await writeFile(path.join(fixture, 'cold', diskName), disk)
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'preview fixture'])
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('search.quickOpenPreview')
      const toggle = selectors.quickOpenPreviewToggle(page)
      await toggle.waitFor({ timeout: 5000 })
      strictEqual(await toggle.getAttribute('aria-checked'), 'false')
      const enabled = page.waitForResponse(
        (response) =>
          response.url().endsWith('/settings/write') && response.request().method() === 'POST',
      )
      await toggle.click()
      strictEqual((await enabled).status(), 200)
      strictEqual(await toggle.getAttribute('aria-checked'), 'true')
      await step('isolated-preview-option-enabled-through-settings')
      await openFixtureWorkspace(page, fixture)
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).waitFor({ timeout: 5000 })
      await selectors.paletteInput(page).fill(liveName)
      await selectors.commandOption(page, liveName).first().waitFor()
      await page.waitForFunction(
        () => document.querySelectorAll('[data-slot="command-list"] [role="option"]').length === 1,
        undefined,
        { timeout: 8000 },
      )
      await page.keyboard.press('ArrowDown')
      await selectors.quickOpenPreview(page).waitFor()
      await page.waitForFunction(
        (target) =>
          document
            .querySelector('[aria-label="File preview"]')
            ?.getAttribute('data-file-preview') === target,
        livePath,
        { timeout: 8000 },
      )
      await page.keyboard.press('Enter')
      await selectors.editorRows(page).filter({ hasText: 'DISK_A' }).first().waitFor()
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await page.keyboard.insertText('DIRTY_A ')
      strictEqual(counts.diskFull, 0, 'Unopened B has no warm full acquisition')
      const fullBaseline = counts.liveFull
      const headBaseline = counts.liveHead
      ok(fullBaseline > 0, 'Actual initial full acquisition calibrates request counting')
      phase = 'live-previews'
      await page.keyboard.press(chords.commandPalette)
      const input = selectors.paletteInput(page)
      await input.waitFor({ timeout: 5_000 })
      await input.fill(liveName)
      const text = selectors.palettePreviewText(page)
      await text.waitFor()
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="File preview"] [data-file-preview-text]')
            ?.textContent?.startsWith('DIRTY_A '),
        undefined,
        { timeout: 8000 },
      )
      const palette = await text.evaluateHandle(captureFilePreviewFrame)
      handles.push(palette)
      const actual = await palette.evaluate(filePreviewFrameFacts)
      ok(actual, 'Actual live preview owner/read was not captured')
      strictEqual(actual.kind, 'live')
      strictEqual(actual.name, liveName)
      strictEqual(actual.sourceClientMatches, true)
      strictEqual(actual.sourceStoreMatches, true)
      strictEqual(actual.environmentId, actual.scope?.environmentId)
      strictEqual(actual.scope?.rootPath, fixture.slice(1))
      strictEqual(actual.interestCount, 1)
      strictEqual(actual.exactReadInStore, true)
      strictEqual(actual.nativeBufferMatches, true)
      strictEqual(actual.currentSnapshotMatches, true)
      strictEqual(actual.complete, false)
      strictEqual(actual.dirty, true)
      strictEqual(actual.canUndo, true)
      strictEqual(actual.projectionHasNativeInput, false)
      strictEqual(actual.editability, 'editable')
      strictEqual(actual.geometryCommitted, true)
      ok(actual.box && actual.box.width > 0 && actual.box.height > 0)
      ok(actual.nativeBox && actual.nativeBox.width > 0 && actual.nativeBox.height > 0)
      ok(actual.paintWidth > 0 && actual.paintHeight > 0 && actual.paintRows > 0)
      ok(
        actual.utf8Bytes !== null &&
          actual.maxBytes !== null &&
          actual.utf8Bytes <= actual.maxBytes,
      )
      throws(() => strictEqual(actual.prefix?.startsWith('DISK_A'), true))
      throws(() => strictEqual(actual.scope?.rootPath, path.join(fixture, 'wrong-owner').slice(1)))
      await evidence.json('live-calibration.json', {
        actual,
        wrongDiskExpectationRejected: true,
        wrongRootExpectationRejected: true,
        controlKind: 'observation assertion discrimination; no live owner injection',
        counts,
        requests,
      })
      await step('live-palette-preview')
      const held = new Promise<void>((resolve) => {
        releaseHead = resolve
      })
      await page.route('**/fs/read?*', async (route) => {
        if (new URL(route.request().url()).searchParams.get('path') !== diskPath)
          return route.continue()
        await held
        await route.continue()
      })
      await page.route('**/fs/head?*', async (route) => {
        if (new URL(route.request().url()).searchParams.get('path') !== diskPath)
          return route.continue()
        await held
        await route.continue()
      })
      const started = page.waitForRequest(
        (item) => {
          const url = new URL(item.url())
          return url.pathname.endsWith('/fs/head') && url.searchParams.get('path') === diskPath
        },
        { timeout: 8000 },
      )
      await input.fill(diskName)
      await page.keyboard.press('ArrowDown')
      await started
      strictEqual(
        await selectors.quickOpenPreview(page).getAttribute('data-file-preview'),
        livePath,
      )
      ok((await text.textContent())?.startsWith('DIRTY_A '))
      strictEqual((await palette.evaluate(filePreviewFrameFacts))?.kind, 'live')
      await evidence.json('held-live-while-disk-pending.json', {
        palette: await palette.evaluate(filePreviewFrameFacts),
        counts,
        requests,
      })
      await step('held-live-subject-while-disk-pending')
      await page.keyboard.press('Escape')
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
      strictEqual((await palette.evaluate(filePreviewFrameFacts))?.kind, 'released')
      strictEqual((await palette.evaluate(filePreviewFrameFacts))?.interestCount, 0)
      await step('palette-close-releases-preview')
      releaseHead()
      await page.unroute('**/fs/head?*')
      await page.unroute('**/fs/read?*')
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await page.keyboard.insertText('SECOND_')
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).waitFor({ timeout: 5_000 })
      await selectors.paletteInput(page).fill(liveName)
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="File preview"] [data-file-preview-text]')
            ?.textContent?.startsWith('SECOND_DIRTY_A '),
        undefined,
        { timeout: 8000 },
      )
      const edited = await selectors
        .palettePreviewText(page)
        .evaluateHandle(captureFilePreviewFrame)
      handles.push(edited)
      const editedFacts = await edited.evaluate(filePreviewFrameFacts)
      ok(
        editedFacts &&
          editedFacts.revision !== null &&
          actual.revision !== null &&
          editedFacts.revision > actual.revision,
      )
      strictEqual(editedFacts.nativeBufferMatches, true)
      const editedIdentity = await edited.evaluate(filePreviewIdentityFacts, palette)
      assertPreviewIdentity(editedIdentity)
      strictEqual(
        (await palette.evaluate(filePreviewFrameFacts))?.capturedSnapshotPrefix,
        actual.capturedSnapshotPrefix,
      )
      await evidence.json('committed-edit-new-source-read.json', {
        editedFacts,
        editedIdentity,
        originalEnded: await palette.evaluate(filePreviewFrameFacts),
        counts,
        requests,
      })
      await step('committed-edit-uses-same-buffer')
      await page.keyboard.press('Escape')
      await focusEditor(page)
      await page.keyboard.press('Control+z')
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).waitFor({ timeout: 5_000 })
      await selectors.paletteInput(page).fill(liveName)
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="File preview"] [data-file-preview-text]')
            ?.textContent?.startsWith('DIRTY_A '),
        undefined,
        { timeout: 8000 },
      )
      const undone = await selectors
        .palettePreviewText(page)
        .evaluateHandle(captureFilePreviewFrame)
      handles.push(undone)
      const undoFacts = await undone.evaluate(filePreviewFrameFacts)
      const undoIdentity = await undone.evaluate(filePreviewIdentityFacts, palette)
      assertPreviewIdentity(undoIdentity)
      ok(undoFacts && undoFacts.revision !== null && undoFacts.revision > editedFacts.revision)
      strictEqual(undoFacts.dirty, true)
      strictEqual(undoFacts.nativeBufferMatches, true)
      strictEqual(undoFacts.capturedPrefix, actual.capturedPrefix)
      strictEqual(
        (await palette.evaluate(filePreviewFrameFacts))?.capturedSnapshotPrefix,
        actual.capturedSnapshotPrefix,
      )
      await evidence.json('undo-source-identity.json', {
        undoFacts,
        undoIdentity,
        counts,
        requests,
      })
      await step('undo-retains-dirty-bounded-source')
      strictEqual(counts.liveHead, headBaseline)
      strictEqual(counts.liveFull, fullBaseline)
      strictEqual(await readFile(path.join(fixture, liveName), 'utf8'), original)
      await selectors.paletteInput(page).fill(diskName)
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="File preview"] [data-file-preview-text]')
            ?.textContent?.startsWith('DISK_B'),
        undefined,
        { timeout: 8000 },
      )
      const bounded = await selectors
        .palettePreviewText(page)
        .evaluateHandle(captureFilePreviewFrame)
      handles.push(bounded)
      const boundedFacts = await bounded.evaluate(filePreviewFrameFacts)
      strictEqual(boundedFacts?.kind, 'live')
      strictEqual(
        boundedFacts.snapshotLength,
        disk.length,
        'Warm preparation acquired the complete source',
      )
      strictEqual(
        boundedFacts.nativeBufferMatches,
        false,
        'Preview alone has no native editable view',
      )
      strictEqual(boundedFacts.complete, false)
      strictEqual(boundedFacts.projectionHasNativeInput, false)
      strictEqual(counts.diskFull, 1)
      await evidence.json('bounded-prepared-source-before-explicit-open.json', {
        provenance:
          'actual full FileOpenIntent preparation; bounded display is not a partial buffer seed',
        boundedFacts,
        counts,
        requests,
      })
      await step('readonly-bounded-prepared-source-before-open')
      const warmFullReads = counts.diskFull
      phase = 'explicit-full-open'
      const fullOpened = page.waitForRequest(
        (item) => {
          const url = new URL(item.url())
          return url.pathname.endsWith('/fs/read') && url.searchParams.get('path') === diskPath
        },
        { timeout: 8000 },
      )
      await page.keyboard.press('Enter')
      await fullOpened
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
      await selectors.editorRows(page).filter({ hasText: 'DISK_B' }).first().waitFor()
      const opened = await bounded.evaluate((frame, target) => {
        if (!frame) return null
        const state = frame.runtime.documentStore.getState()
        const document = Object.values(state.liveDocumentsByKey).find(
          (entry) => entry.target.kind === 'file' && entry.target.resource?.path === target,
        )
        const view = document
          ? Object.values(state.viewsByTabId).find((entry) => entry.documentKey === document.key)
          : null
        const controller = view
          ? frame.runtime.uiStore.getState().controllersByTabId.get(view.tabId)
          : null
        const native = controller?.getEditor()
        const snapshot = document?.buffer.getTextSnapshot()
        return {
          sameNativeBuffer: native?.getBufferSession()?.buffer === document?.buffer,
          length: snapshot?.length,
          suffix: snapshot?.readRange(Math.max(0, snapshot.length - 6), snapshot.length),
          editability: native?.getState().editability,
          geometryCommitted: controller?.getSnapshot()?.geometryCommitted,
          dirty: document?.buffer.isDirty(),
          previewEnded: frame.lease?.read().kind,
          interests: state.previewSources.size,
          sync: document?.sync.kind,
        }
      }, diskPath)
      ok(opened)
      strictEqual(opened.sameNativeBuffer, true)
      strictEqual(opened.length, disk.length)
      strictEqual(opened.suffix, 'END_B\n')
      strictEqual(opened.editability, 'editable')
      strictEqual(opened.dirty, false)
      strictEqual(opened.sync, 'file')
      strictEqual(opened.previewEnded, 'released')
      strictEqual(opened.interests, 0)
      strictEqual(counts.diskFull - warmFullReads, 1)
      strictEqual(opened.geometryCommitted, true)
      await evidence.json('explicit-full-open.json', { opened, counts, requests })
      await step('explicit-open-acquires-full-editable-source')
      await evidence.json('final-requests.json', {
        counts,
        requests,
        livePreviewHeadReads: counts.liveHead - headBaseline,
        livePreviewFullReads: counts.liveFull - fullBaseline,
        warmFullReads,
        explicitFullReads: requests.filter(
          (item) =>
            item.phase === 'explicit-full-open' &&
            item.route.endsWith('/fs/read') &&
            item.target === diskPath,
        ).length,
      })
    } catch (error) {
      primary = { error }
    } finally {
      await finishPreviewScenario(
        primary,
        [
          ...(primary
            ? [
                {
                  name: 'failed-request-evidence',
                  run: () =>
                    evidence.json('failed-native-request-facts.json', { phase, counts, requests }),
                },
                {
                  name: 'failure-capture',
                  run: () => captureScenarioFailure(page, evidence, 'before-cleanup'),
                },
              ]
            : []),
          { name: 'release-head', run: () => releaseHead() },
          { name: 'request-listener', run: () => page.off('request', request) },
          { name: 'head-route', run: () => page.unroute('**/fs/head?*') },
          { name: 'read-route', run: () => page.unroute('**/fs/read?*') },
          ...handles.map((handle, index) => ({
            name: `handle-${index}`,
            run: () => handle.dispose(),
          })),
          { name: 'navigate-blank', run: () => page.goto('about:blank') },
          {
            name: 'release-fixture',
            run: async () => {
              await releaseFixture(fixture)
              fixtureReleased = true
            },
          },
        ],
        (failures) =>
          evidence.json('fixture-cleanup.json', { released: fixtureReleased, fixture, failures }),
      )
    }
  },
}

function assertPreviewIdentity(facts: ReturnType<typeof filePreviewIdentityFacts>) {
  ok(facts, 'Actual longitudinal live references were captured')
  for (const [name, matches] of Object.entries(facts)) strictEqual(matches, true, name)
}

async function finishPreviewScenario(
  primary: { error: unknown } | null,
  stages: readonly { name: string; run(): unknown | Promise<unknown> }[],
  report: (failures: readonly { stage: string; error: string }[]) => Promise<unknown>,
) {
  const failures: { stage: string; error: unknown }[] = []
  for (const stage of stages) {
    try {
      await stage.run()
    } catch (error) {
      failures.push({ stage: stage.name, error })
    }
  }
  const describe = () =>
    failures.map(({ stage, error }) => ({
      stage,
      error: error instanceof Error ? error.message : String(error),
    }))
  try {
    await report(describe())
  } catch (error) {
    failures.push({ stage: 'cleanup-evidence', error })
  }
  if (failures.length) {
    try {
      process.stderr.write(`${JSON.stringify({ previewSecondaryFailures: describe() })}\n`)
    } catch {
      // A broken evidence sink cannot replace the scenario or cleanup failure.
    }
  }
  if (primary) throw primary.error
  const first = failures[0]
  if (first) throw first.error
}
