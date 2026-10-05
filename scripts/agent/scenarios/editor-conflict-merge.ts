import { scratchPath } from '../paths'
import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { JSHandle } from 'playwright'
import { createScriptError } from '../../structured-errors'
import { captureScenarioFailure } from '../scenario-failure'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { focusEditor, openFileFromTree, runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

const filename = 'conflict-probe.txt'

export const editorConflictMerge: Scenario = {
  name: 'editor-conflict-merge',
  description:
    'Compare original and latest immutable conflict captures, return to the edited resolution and Undo, then settle the actual save.',
  requiresIsolatedServer: true,
  async run(page, { step, evidence }) {
    const fixture = await mkdtemp(scratchPath('fregat-conflict-merge-'))
    const disk = path.join(fixture, filename)
    const prefix = Array.from({ length: 80 }, (_, index) => `shared line ${index + 1}`).join('\n')
    let identity: JSHandle<ConflictIdentity | null> | null = null
    try {
      await writeFile(disk, `${prefix}\nbase line\n`)
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, filename)
      await selectors.editorRows(page).filter({ hasText: 'shared line 1' }).first().waitFor()
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await writeFile(disk, `${prefix}\nbase line\nWATCH_READY\n`)
      await selectors.editorRows(page).filter({ hasText: 'WATCH_READY' }).waitFor({ timeout: 8000 })
      await page.keyboard.press('Control+End')
      await page.keyboard.type('LOCAL_EDIT')
      await writeFile(disk, `${prefix}\nREMOTE_EDIT\n`)
      const dialog = selectors.fileConflict(page, filename)
      await dialog.waitFor({ timeout: 8000 })
      await step('conflict-offered')
      await dialog.getByRole('button', { name: 'Compare', exact: true }).click()
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await selectors
        .mergeConflictLensAction(page, 'Accept Current Change')
        .first()
        .waitFor({ timeout: 8000 })
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText('RESOLUTION_NOTE\n')
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('Shift+ArrowRight')
      identity = await selectors.editorInput(page).first().evaluateHandle(captureConflictIdentity)
      const before = await identity.evaluate(observeConflict)
      ok(
        before?.editing?.insideMarker,
        'actual user selection must be inside the merge marker region',
      )
      strictEqual(before.editing.actualResolutionBuffer, true)
      ok(before.editing.scroll.top > 0, 'the actual resolution must have a nonzero scroll position')
      ok(before.resolutionText.includes('RESOLUTION_NOTE'))
      strictEqual(before.interests, 2)
      await evidence.json('resolution-before-compare.json', before)
      await step('edited-resolution')

      await runPaletteCommand(page, 'Merge conflict: compare current conflict')
      await selectors.conflictOriginalComparison(page).waitFor({ timeout: 8000 })
      const original = await waitForCapture(identity, 'seed')
      strictEqual(original.interests, 3)
      strictEqual(original.editing, null)
      await evidence.json('original-capture.json', original)
      await step('original-comparison')

      await writeFile(disk, `${prefix}\nLATEST_INCOMING\n`)
      await waitForIncoming(identity, 'LATEST_INCOMING')
      const refreshed = await identity.evaluate(observeConflict)
      ok(refreshed)
      strictEqual(refreshed.sameSeed, true)
      strictEqual(refreshed.firstLatestState, 'released')
      strictEqual(refreshed.seedState, 'ready')
      strictEqual(refreshed.display?.exactSeed, true)
      throws(
        () => strictEqual(refreshed.display?.exactLatest, true),
        'a latest-only observer must reject this actual original view',
      )
      await evidence.json('wrong-observer-control.json', {
        expectedRead: 'latest',
        actualRead: refreshed.display?.meaning,
        exactLatest: refreshed.display?.exactLatest,
        rejected: true,
        facts: refreshed,
      })
      await selectors.conflictLatestIncoming(page).click()
      const latest = await waitForCapture(identity, 'latest')
      ok(latest.display?.text.includes('LATEST_INCOMING'))
      strictEqual(latest.sameSeed, true)
      strictEqual(latest.resolutionText, before.resolutionText)
      await evidence.json('latest-capture.json', latest)
      await step('latest-incoming')
      await selectors.conflictOriginalComparison(page).click()
      await waitForCapture(identity, 'seed')
      await selectors.conflictReturnResolution(page).click()
      await selectors.editorInput(page).first().waitFor({ timeout: 8000 })
      const returned = await identity.evaluate(observeConflict)
      ok(returned?.editing)
      strictEqual(returned.sameBuffer, true)
      strictEqual(returned.sameView, true)
      strictEqual(returned.editing.focused, true)
      strictEqual(returned.editing.editability, 'editable')
      strictEqual(returned.editing.actualResolutionBuffer, true)
      strictEqual(returned.resolutionText, before.resolutionText)
      deepStrictEqual(returned.editing.selections, before.editing.selections)
      deepStrictEqual(returned.editing.scroll, before.editing.scroll)
      strictEqual(returned.interests, 2)
      await evidence.json('resolution-returned.json', returned)
      await step('returned-resolution')
      await page.keyboard.press('Control+Z')
      const undone = await identity.evaluate(observeConflict)
      ok(undone?.editing)
      ok(!undone.resolutionText.includes('RESOLUTION_NOTE'))
      ok(undone.resolutionText.includes('<<<<<<<'))
      strictEqual(undone.sameBuffer, true)
      await evidence.json('resolution-undo.json', undone)
      await step('resolution-undo')
      await selectors.mergeConflictLensAction(page, 'Accept Current Change').first().click()
      const saved = await waitForResolvedFile(disk)
      ok(saved.includes('LOCAL_EDIT'), `the local side was not kept: ${JSON.stringify(saved)}`)
      ok(!saved.includes('REMOTE_EDIT') && !saved.includes('LATEST_INCOMING'))
      await dialog.waitFor({ state: 'hidden', timeout: 5000 })
      const settled = await identity.evaluate(observeConflict)
      ok(settled)
      strictEqual(settled.conflictPresent, false)
      strictEqual(settled.interests, 0)
      strictEqual(settled.seedState, 'released')
      strictEqual(settled.currentOriginalText, saved)
      strictEqual(settled.currentOriginalSync, 'idle')
      ok(settled.currentOriginalVersion)
      strictEqual(settled.originalCapturedText, before.originalCapturedText)
      await evidence.json('saved-settlement.json', { saved, facts: settled })
      await step('resolved-and-saved')
    } catch (error) {
      if (identity)
        await evidence.json(
          'failure-current-facts.json',
          await identity.evaluate(observeConflict).catch(() => null),
        )
      await captureScenarioFailure(page, evidence, 'before-cleanup')
      throw error
    } finally {
      await identity?.dispose()
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
      await releaseFixture(fixture)
    }
  },
}

type ObservedBuffer = { materializeFullText(): string }
type ObservedDiffFile = { path: string }
type ObservedDiffPlugin = { getRows(): readonly { text: string }[] }
type ObservedEditor = {
  getInputElement(): HTMLElement
  getState(): { documentId: string | null; editability: string }
  getPresentationState(): string
  captureSnapshot(): { paint: string; documentId: string | null; textVersion: number } | null
  getSelections(): readonly { anchorOffset: number; headOffset: number }[]
  getScrollPosition(): { left: number; top: number }
  getMergeConflicts(): readonly { range: { start: number; end: number } }[]
  getBufferSession(): { buffer: ObservedBuffer } | null
  materializeFullText(): string
}
type ObservedController = {
  getEditor(): ObservedEditor | null
  getSnapshot(): { geometryCommitted: boolean } | null
}

type FileRecord = { path: string; version: string; content: string }
type ComparisonInput = {
  kind: string
  scope: { environmentId: string; rootPath: string }
  capture: {
    conflictId: string
    local: {
      kind: string
      path: string
      buffer?: ObservedBuffer
      snapshot?: { materializeFullText(): string }
      revision?: number
    }
    incoming: { kind: string; file?: FileRecord; reader?: { materializeFullText(): string } }
  }
  display: { kind: string; file?: ObservedDiffFile }
}
type Lease = { read(): { kind: string; input?: ComparisonInput } }
type Retained = { input: ComparisonInput; lease: Lease }
type Seed = { resolutionKey: string; buffer: ObservedBuffer; comparison: Retained }
type Conflict = { id: string; remoteFile: FileRecord | null; latest: Retained; seed?: Seed }
type Resolution = {
  key: string
  buffer: ObservedBuffer
  target: { kind: string; resource?: { path: string } }
  sync?: { fileVersion?: string; state?: string }
}
type BrowserRuntime = {
  conflictStore: { getState(): { conflicts: Readonly<Record<string, Conflict>> } }
  documentStore: {
    getState(): {
      liveDocumentsByKey: Readonly<Record<string, Resolution>>
      viewsByTabId: Readonly<Record<string, { tabId: string; documentKey: string; view: object }>>
      snapshotComparisons: ReadonlyMap<Lease, unknown>
    }
  }
  uiStore: { getState(): { controllersByTabId: ReadonlyMap<string, ObservedController> } }
}
type Fiber = {
  return: Fiber | null
  child: Fiber | null
  sibling: Fiber | null
  memoizedProps: Record<string, unknown>
  stateNode?: { current: Fiber }
}
type ConflictIdentity = {
  runtime: BrowserRuntime
  conflict: Conflict
  seed: Seed
  resolution: Resolution
  view: object
  tabId: string
  root: { current: Fiber }
  ownerDocument: Document
}

// The existing provider and native controller are read through development fiber; no app probe is installed.
function captureConflictIdentity(element: Element): ConflictIdentity | null {
  let host: Element | null = element
  let fiber: Fiber | null = null
  while (host && !fiber) {
    const key = Object.keys(host).find((entry) => entry.startsWith('__reactFiber$'))
    if (key) fiber = Reflect.get(host, key)
    host = host.parentElement
  }
  let runtime: BrowserRuntime | null = null
  const isStore = (value: unknown): value is { getState(): unknown } =>
    Boolean(
      value &&
      typeof value === 'object' &&
      'getState' in value &&
      typeof value.getState === 'function',
    )
  const isRuntime = (value: unknown): value is BrowserRuntime =>
    Boolean(
      value &&
      typeof value === 'object' &&
      'documentStore' in value &&
      'conflictStore' in value &&
      'uiStore' in value &&
      isStore(value.documentStore) &&
      isStore(value.conflictStore) &&
      isStore(value.uiStore),
    )
  while (fiber) {
    const candidate = fiber.memoizedProps?.runtime
    if (isRuntime(candidate)) runtime = candidate
    if (!fiber.return) break
    fiber = fiber.return
  }
  if (!runtime || !fiber?.stateNode) return null
  const conflict = Object.values(runtime.conflictStore.getState().conflicts).find(
    (entry) => entry.seed,
  )
  if (!conflict?.seed) return null
  const documents = runtime.documentStore.getState()
  const resolution = documents.liveDocumentsByKey[conflict.seed.resolutionKey]
  const view = Object.values(documents.viewsByTabId).find(
    (entry) => entry.documentKey === conflict.seed?.resolutionKey,
  )
  if (!resolution || !view) return null
  return {
    runtime,
    conflict,
    seed: conflict.seed,
    resolution,
    view: view.view,
    tabId: view.tabId,
    root: fiber.stateNode,
    ownerDocument: element.ownerDocument,
  }
}

function observeConflict(identity: ConflictIdentity | null) {
  if (!identity) return null
  const { runtime, seed, resolution, view, tabId } = identity
  const docs = runtime.documentStore.getState()
  const current = runtime.conflictStore.getState().conflicts[identity.conflict.id]
  const currentOriginal = Object.values(docs.liveDocumentsByKey).find(
    (document) =>
      document.target.kind === 'file' &&
      document.target.resource?.path === seed.comparison.input.capture.local.path,
  )
  const controller = runtime.uiStore.getState().controllersByTabId.get(tabId)
  const editor = controller?.getEditor()
  const nativeFacts = (native: ObservedEditor, owner: ObservedController) => {
    const input = native.getInputElement()
    const scroller = input.closest('.editor-virtualized')
    const rect = scroller?.getBoundingClientRect()
    const captured = native.captureSnapshot()
    const paint = captured ? JSON.parse(captured.paint) : null
    const snapshot = owner.getSnapshot()
    const selections = native.getSelections()
    return {
      documentId: native.getState().documentId,
      textVersion: captured?.textVersion,
      snapshotDocumentId: captured?.documentId,
      snapshotGeometryCommitted: snapshot?.geometryCommitted ?? null,
      live: native.getPresentationState(),
      editability: native.getState().editability,
      focused: input === input.ownerDocument.activeElement,
      connected: input.isConnected,
      sameDocument: input.ownerDocument === identity.ownerDocument,
      rect: rect ? { width: rect.width, height: rect.height } : null,
      width: paint?.viewportWidth ?? 0,
      height: paint?.viewportHeight ?? 0,
      visibleRows: paint?.rows.length ?? 0,
      selections,
      scroll: native.getScrollPosition(),
      insideMarker: native
        .getMergeConflicts()
        .some((region) =>
          selections.some(
            (selection) =>
              selection.headOffset >= region.range.start && selection.headOffset < region.range.end,
          ),
        ),
      text: native.materializeFullText(),
    }
  }
  const isController = (value: unknown): value is ObservedController =>
    Boolean(
      value &&
      typeof value === 'object' &&
      'getEditor' in value &&
      typeof value.getEditor === 'function' &&
      'getSnapshot' in value &&
      typeof value.getSnapshot === 'function',
    )
  const isAttachment = (
    value: unknown,
  ): value is {
    read: { kind: string; input: ComparisonInput }
    file: ObservedDiffFile
    meaning: string
  } =>
    Boolean(
      value &&
      typeof value === 'object' &&
      'read' in value &&
      'file' in value &&
      'meaning' in value,
    )
  const isPresentation = (value: unknown): value is { plugin: ObservedDiffPlugin } =>
    Boolean(
      value &&
      typeof value === 'object' &&
      'plugin' in value &&
      value.plugin &&
      typeof value.plugin === 'object' &&
      'getRows' in value.plugin &&
      typeof value.plugin.getRows === 'function',
    )
  const sourceFacts = (input: ComparisonInput) => ({
    kind: input.kind,
    scope: input.scope,
    conflictId: input.capture.conflictId,
    local: {
      kind: input.capture.local.kind,
      revision: input.capture.local.revision,
      text: input.capture.local.snapshot?.materializeFullText(),
    },
    incoming: {
      kind: input.capture.incoming.kind,
      file: input.capture.incoming.file,
      text: input.capture.incoming.reader?.materializeFullText(),
    },
    display: { kind: input.display.kind, path: input.display.file?.path },
  })
  const pending: (Fiber | null)[] = [identity.root.current]
  let display = null
  while (pending.length) {
    const fiber = pending.pop()
    if (!fiber) continue
    pending.push(fiber.child, fiber.sibling)
    const candidate = fiber.memoizedProps?.controller
    if (!isController(candidate)) continue
    const native = candidate.getEditor()
    if (!native?.getState().documentId?.startsWith('projection:diff:')) continue
    let ancestor = fiber.return
    while (ancestor && !ancestor.memoizedProps?.attachment) ancestor = ancestor.return
    const attachment = ancestor?.memoizedProps?.attachment
    const presentation = ancestor?.memoizedProps?.presentation
    if (!isAttachment(attachment) || !isPresentation(presentation)) continue
    const read = attachment.read
    display = {
      ...nativeFacts(native, candidate),
      meaning: attachment.meaning,
      exactSeed: read === seed.comparison.lease.read(),
      exactLatest: read === current?.latest.lease.read(),
      exactFile: attachment.file === read.input.display.file,
      sameScope:
        read.input.scope.environmentId === seed.comparison.input.scope.environmentId &&
        read.input.scope.rootPath === seed.comparison.input.scope.rootPath,
      source: sourceFacts(read.input),
      text: native.materializeFullText(),
      projectionText: presentation.plugin
        .getRows()
        .map((row) => row.text)
        .join('\n'),
    }
  }
  return {
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight },
    conflictPresent: Boolean(current),
    sameSeed: current?.seed === seed,
    sameBuffer: docs.liveDocumentsByKey[seed.resolutionKey]?.buffer === resolution.buffer,
    sameView: docs.viewsByTabId[tabId]?.view === view,
    resolutionText: resolution.buffer.materializeFullText(),
    originalBufferText: seed.comparison.input.capture.local.buffer?.materializeFullText(),
    currentOriginalText: currentOriginal?.buffer.materializeFullText(),
    currentOriginalVersion: currentOriginal?.sync?.fileVersion,
    currentOriginalSync: currentOriginal?.sync?.state,
    sameOriginalBuffer: currentOriginal?.buffer === seed.comparison.input.capture.local.buffer,
    originalCapturedText: seed.comparison.input.capture.local.snapshot?.materializeFullText(),
    seedState: seed.comparison.lease.read().kind,
    firstLatestState: identity.conflict.latest.lease.read().kind,
    latest: current ? sourceFacts(current.latest.input) : null,
    interests: docs.snapshotComparisons.size,
    editing:
      editor && controller
        ? {
            ...nativeFacts(editor, controller),
            actualResolutionBuffer: editor.getBufferSession()?.buffer === resolution.buffer,
          }
        : null,
    display,
  }
}

async function waitForIncoming(identity: JSHandle<ConflictIdentity | null>, text: string) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const facts = await identity.evaluate(observeConflict)
    if (facts?.latest?.incoming.file?.content.includes(text)) return
    await Bun.sleep(100)
  }
  throw createScriptError('The actual incoming conflict capture did not refresh.', {
    internal: { timeoutMs: 8000 },
  })
}

async function waitForCapture(
  identity: JSHandle<ConflictIdentity | null>,
  meaning: 'seed' | 'latest',
) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const facts = await identity.evaluate(observeConflict)
    if (
      facts?.display?.meaning === meaning &&
      facts.display.width > 0 &&
      facts.display.height > 0 &&
      facts.display.visibleRows > 0
    ) {
      strictEqual(facts.display.connected, true)
      strictEqual(facts.display.sameDocument, true)
      strictEqual(facts.display.live, 'live')
      strictEqual(facts.display.editability, 'readonly')
      strictEqual(facts.display.exactFile, true)
      strictEqual(facts.display.sameScope, true)
      strictEqual(facts.display.snapshotDocumentId, facts.display.documentId)
      strictEqual(facts.display.text, facts.display.projectionText)
      strictEqual(meaning === 'seed' ? facts.display.exactSeed : facts.display.exactLatest, true)
      ok(facts.display.rect && facts.display.rect.width > 0 && facts.display.rect.height > 0)
      return facts
    }
    await Bun.sleep(100)
  }
  throw createScriptError(
    'The captured native comparison did not deliver positive current geometry.',
    { internal: { timeoutMs: 8000 } },
  )
}

async function waitForResolvedFile(file: string): Promise<string> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const text = await readFile(file, 'utf8')
    if (text.includes('LOCAL_EDIT') && !text.includes('<<<<<<<')) return text
    await Bun.sleep(100)
  }
  return readFile(file, 'utf8')
}
