import {
  captureNativeConflictOwner,
  type NativeConflictOwner,
  type NativeConflictFiber as Fiber,
} from '../native-conflict-owner'
import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import type { JSHandle } from 'playwright'

import { platformHomePath } from '../../../apps/server/src/home'
import { createScriptError } from '../../structured-errors'
import { captureScenarioFailure } from '../scenario-failure'
import { readCaches } from '../cache-snapshot'
import { settingsNativeHostSelector, settingsComparisonSelector, selectors } from '../selectors'
import type { Scenario } from './index'

const EXTERNAL_KEY = '"editor.lineHeight": 31'
const NEWER_KEY = '"editor.lineHeight": 32'
const PENDING_KEY = '"editor.lineHeight": 33'

export const settingsRawConflict: Scenario = {
  name: 'settings-raw-conflict',
  description:
    'Compare a real settings conflict while the current editable buffer, selection and Undo remain active; advance confirmation, Hide and reopen, then settle through the existing write owner.',
  requiresIsolatedServer: true,
  async run(page, { step, evidence, server }) {
    ok(server, 'settings conflict uses this run’s isolated API')
    const settingsFile = platformHomePath('settings.json')
    const original = await readFile(settingsFile, 'utf8').catch(() => '{}\n')
    ok(original.trimStart().startsWith('{'), 'user settings must be a JSON object')
    const padded = '\n'.repeat(140) + original
    let identity: JSHandle<SettingsIdentity | null> | null = null
    let firstBinding: JSHandle<SettingsBinding | null> | null = null
    let secondBinding: JSHandle<SettingsBinding | null> | null = null
    const pendingReadyBindings: JSHandle<SettingsBinding | null>[] = []
    try {
      await writeFile(settingsFile, padded)
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).waitFor()
      await selectors.settingsScopeTab(page, 'User').click()
      await selectors.settingsJsonView(page).click()
      await selectors.settingsEditableViewport(page).click()
      await page.keyboard.press('Control+Home')
      await page.keyboard.type(' ')
      for (let line = 0; line < 65; line++) await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Shift+ArrowDown')
      const owner = await selectors
        .writableEditorInput(page)
        .evaluateHandle<NativeConflictOwner | null, 'settings'>(
          captureNativeConflictOwner,
          'settings',
        )
      try {
        identity = await owner.evaluateHandle(captureSettingsIdentity, {
          comparison: settingsComparisonSelector,
          host: settingsNativeHostSelector,
        })
      } finally {
        await owner.dispose()
      }
      const edited = await identity.evaluate(observeSettings, null)
      const settingsOwner = identity
      ok(edited?.native.focused)
      ok(edited.native.scroll.top > 0, 'actual settings editing is scrolled')
      strictEqual(edited.sourceInterests, 0)
      await evidence.json('edited-native.json', edited)
      await step('edited')

      await writeFile(settingsFile, padded.replace('{', `{\n  ${EXTERNAL_KEY},`))
      await page.keyboard.press('Control+s')
      const banner = selectors.settingsRawConflictBanner(page)
      await banner.waitFor({ timeout: 10_000 })
      await selectors.settingsKeepChanges(page).waitFor()
      const conflictBeforeCompare = await identity.evaluate(observeSettings, null)
      ok(conflictBeforeCompare)
      await evidence.json('conflict-before-compare.json', conflictBeforeCompare)
      await step('conflict')

      await selectors.settingsCompare(page).click()
      await page.getByText('Latest version', { exact: true }).waitFor()
      await page.getByText(EXTERNAL_KEY).last().waitFor({ timeout: 10_000 })
      await selectors.diffPanes(page).first().hover()
      await page.mouse.wheel(0, 250)
      const compared = await waitForSettings(identity, (facts) =>
        Boolean(
          facts.display?.exactCurrentRead &&
          facts.display.native.visibleText.includes(EXTERNAL_KEY),
        ),
      )
      strictEqual(compared.sameNative, true)
      strictEqual(compared.sameBuffer, true)
      strictEqual(compared.sameView, true)
      strictEqual(compared.sameController, true)
      strictEqual(compared.sourceInterests, 1)
      strictEqual(compared.nativeUsesCurrentBuffer, true)
      strictEqual(compared.source?.sameEnvironment, true)
      strictEqual(compared.source?.sameRoot, true)
      deepStrictEqual(compared.native.selections, conflictBeforeCompare.native.selections)
      deepStrictEqual(compared.native.scroll, conflictBeforeCompare.native.scroll)
      ok(compared.display?.confirmed?.text.includes(EXTERNAL_KEY))
      ok(compared.display?.native.connected && compared.display.native.capturedCurrentPaint)
      strictEqual(compared.display.native.editability, 'readonly')
      ok(compared.display.native.rect.width > 0 && compared.display.native.rect.height > 0)
      ok(compared.native.rect.width > 0 && compared.native.rect.height > 0)
      ok(compared.region && compared.region.height < compared.native.rect.height)
      firstBinding = await identity.evaluateHandle(captureSettingsBinding)
      await evidence.json('compare-native.json', compared)
      await step('compare')

      await selectors.writableEditorInput(page).focus()
      const typingBefore = await identity.evaluate(observeSettings, null)
      ok(typingBefore?.native.focused)
      await page.keyboard.insertText(' ')
      const typed = await waitForSettings(identity, (facts) =>
        Boolean(
          facts.source?.local.text !== typingBefore.localText && facts.display?.exactCurrentRead,
        ),
      )
      strictEqual(typed.source?.local.exactSnapshot, true)
      strictEqual(typed.source?.local.revision, typed.bufferRevision)
      strictEqual(typed.source?.local.text, typed.localText)
      strictEqual(typed.display?.exactBuffer, true)
      strictEqual(typed.sameNative, true)
      strictEqual(typed.native.focused, true)
      throws(
        () => strictEqual(typed.source?.local.text, typingBefore.source?.local.text),
        'the old local observer must reject the committed current-local source',
      )
      await evidence.json('wrong-old-pair-control.json', {
        rejected: true,
        old: typingBefore.source,
        actual: typed.source,
      })
      await evidence.json('typed-current-local.json', typed)
      await step('typed-while-compared')
      await page.keyboard.press('Control+z')
      const undone = await waitForSettings(
        identity,
        (facts) =>
          facts.localText === typingBefore.localText && Boolean(facts.display?.exactCurrentRead),
      )
      strictEqual(undone.sameNative, true)
      strictEqual(undone.native.focused, true)
      deepStrictEqual(undone.native.selections, typingBefore.native.selections)
      await evidence.json('native-undo.json', undone)
      await step('undo-while-compared')

      const newerText = padded.replace('{', `{\n  ${NEWER_KEY},`)
      await writeFile(settingsFile, newerText)
      const advanced = await waitForSettings(
        identity,
        (facts) =>
          facts.source?.confirmed?.text === newerText && Boolean(facts.display?.exactCurrentRead),
      )
      strictEqual(advanced.sameNative, true)
      strictEqual(advanced.sameBuffer, true)
      strictEqual(advanced.localText, undone.localText)
      ok(advanced.source?.confirmed?.revision !== compared.source?.confirmed?.revision)
      strictEqual(await readFile(settingsFile, 'utf8'), newerText)
      await evidence.json('confirmed-independent-advance.json', advanced)
      await step('newer-confirmation')

      const pendingText = padded.replace('{', `{\n  ${PENDING_KEY},`)
      await page.route(
        (url) => url.pathname === '/settings',
        (route) => route.abort('failed'),
      )
      await page.route(
        (url) => url.pathname === '/settings/raw',
        async (route) => {
          await writeFile(settingsFile, pendingText)
          await waitForSettings(
            settingsOwner,
            (facts) =>
              facts.source?.confirmed?.text === pendingText &&
              Boolean(facts.display?.exactCurrentRead),
          )
          pendingReadyBindings.push(await settingsOwner.evaluateHandle(captureSettingsBinding))
          await route.continue()
        },
        { times: 1 },
      )
      await selectors.settingsKeepChanges(page).click()
      const pending = await waitForSettings(
        identity,
        (facts) => facts.source?.confirmedKind === 'pending',
      )
      strictEqual(pending.sync.revision, null)
      strictEqual(pending.sameNative, true)
      strictEqual(pending.localText, undone.localText)
      strictEqual(pending.display?.exactCurrentRead, false)
      ok(pending.display?.confirmed)
      strictEqual(pending.display.confirmed.text, pendingText)
      const pendingReadyBinding = pendingReadyBindings.at(-1)
      ok(pendingReadyBinding)
      const held = await identity.evaluate(observeSettings, pendingReadyBinding)
      strictEqual(held?.display?.exactCapturedRead, true)
      strictEqual(held?.display?.exactCapturedFile, true)
      strictEqual(held?.display?.exactCapturedReader, true)
      strictEqual(await selectors.settingsKeepChanges(page).isDisabled(), true)
      strictEqual(await selectors.settingsUseLatest(page).isDisabled(), true)
      strictEqual(await selectors.settingsHideComparison(page).isEnabled(), true)
      await evidence.json('pending-held-whole-view.json', held)
      await step('pending-confirmation')
      await selectors.settingsHideComparison(page).click()
      await selectors.settingsComparison(page).waitFor({ state: 'hidden' })
      const hidden = await identity.evaluate(observeSettings, null)
      ok(hidden)
      strictEqual(hidden.sourceInterests, 0)
      strictEqual(await firstBinding.evaluate((binding) => binding?.lease.read().kind), 'released')
      strictEqual(await selectors.settingsCompare(page).isDisabled(), true)
      await selectors.writableEditorInput(page).focus()
      const focusedAfterHide = await identity.evaluate(observeSettings, null)
      strictEqual(focusedAfterHide?.native.focused, true)
      strictEqual(focusedAfterHide?.sameNative, true)
      await evidence.json('hidden-pending.json', hidden)
      await step('hidden-pending')
      await page.unrouteAll({ behavior: 'wait' })
      await writeFile(settingsFile, newerText)
      await waitForSettings(
        identity,
        (facts) => facts.sync.confirmedText === newerText && facts.sync.revision !== null,
      )
      await selectors.settingsCompare(page).click()
      const reopened = await waitForSettings(identity, (facts) =>
        Boolean(facts.display?.exactCurrentRead),
      )
      secondBinding = await identity.evaluateHandle(captureSettingsBinding)
      strictEqual(
        await secondBinding.evaluate(
          (binding, previous) => binding?.lease === previous?.lease,
          firstBinding,
        ),
        false,
      )
      strictEqual(await firstBinding.evaluate((binding) => binding?.lease.read().kind), 'released')
      strictEqual(reopened.sameNative, true)
      strictEqual(reopened.sameView, true)
      strictEqual(reopened.localText, undone.localText)
      strictEqual(reopened.sourceInterests, 1)
      await evidence.json('reopened-new-binding.json', reopened)
      await step('reopened-comparison')

      await selectors.settingsKeepChanges(page).click()
      const saved = await waitForSettings(identity, (facts) => facts.sync.state === 'idle')
      strictEqual(await readFile(settingsFile, 'utf8'), undone.localText)
      await selectors.settingsComparison(page).waitFor({ state: 'hidden' })
      strictEqual(saved.sameNative, true)
      strictEqual(saved.sameBuffer, true)
      strictEqual(saved.sourceInterests, 0)
      ok(
        saved.native.visibleText.includes('"workbench.wallpaper"'),
        'saved screenshot paints the retained local settings',
      )
      strictEqual(await secondBinding.evaluate((binding) => binding?.lease.read().kind), 'released')
      await evidence.json('saved-disk-and-release.json', saved)
      await evidence.json('query-and-mutation-counts.json', await page.evaluate(readCaches))
      await step('saved-and-released')
      await selectors.writableEditorInput(page).focus()
      await page.keyboard.press('Control+w')
      await page.waitForFunction(
        (owner) => !owner?.native.getInputElement().isConnected,
        identity,
        { timeout: 8000 },
      )
      const closed = await identity.evaluate((owner) =>
        owner
          ? {
              connected: owner.native.getInputElement().isConnected,
              capturedPaint: owner.native.captureSnapshot(),
              sourceInterests: owner.runtime.documentStore.getState().snapshotComparisons.size,
              controllerPresent: owner.runtime.uiStore
                .getState()
                .controllersByTabId.has(owner.tabId),
              bufferText: owner.buffer.materializeFullText(),
            }
          : null,
      )
      ok(closed)
      strictEqual(closed.connected, false)
      strictEqual(closed.capturedPaint, null)
      strictEqual(closed.sourceInterests, 0)
      strictEqual(closed.controllerPresent, false)
      strictEqual(closed.bufferText, undone.localText)
      strictEqual(await firstBinding.evaluate((binding) => binding?.lease.read().kind), 'released')
      strictEqual(await secondBinding.evaluate((binding) => binding?.lease.read().kind), 'released')
      await evidence.json('native-closed-and-terminal.json', closed)
      await step('closed-and-terminal')
    } catch (error) {
      if (identity)
        await evidence.json(
          'failure-current-facts.json',
          await identity.evaluate(observeSettings, null).catch(() => null),
        )
      await captureScenarioFailure(page, evidence, 'before-cleanup')
      throw error
    } finally {
      await page.unrouteAll({ behavior: 'wait' })
      await secondBinding?.dispose()
      await Promise.all(pendingReadyBindings.map((binding) => binding.dispose()))
      await firstBinding?.dispose()
      await identity?.dispose()
      await writeFile(settingsFile, original)
    }
  },
}

type Reader = { materializeFullText(): string }
type Buffer = Reader & { getRevision(): number; getTextSnapshot(): Reader }
type SettingsInput = {
  kind: 'settings'
  key: string
  target: string
  scope: { environmentId: string; rootPath: string }
  local: { buffer: Buffer; revision: number; snapshot: Reader }
  confirmed: { kind: 'pending' } | { kind: 'confirmed'; reader: Reader; revision: string }
}
type SettingsRead = { kind: 'ready'; input: SettingsInput } | { kind: 'released' }
type SettingsLease = { read(): SettingsRead }
type NativeEditor = {
  getInputElement(): HTMLElement
  getBufferSession(): { buffer: Buffer } | null
  getState(): { documentId: string | null; editability: string }
  getPresentationState(): string
  getSelections(): readonly { anchorOffset: number; headOffset: number }[]
  getScrollPosition(): { left: number; top: number }
  captureSnapshot(): { paint: string; documentId: string | null; textVersion: number } | null
  materializeFullText(): string
}
type Controller = {
  getEditor(): NativeEditor | null
  getSnapshot(): { geometryCommitted: boolean } | null
}
type SettingsDocument = {
  key: string
  target: { kind: string; target?: string }
  buffer: Buffer
  sync: { kind: string; state: string; revision: string | null; confirmedText?: string | null }
}
type SettingsRuntime = {
  documentStore: {
    getState(): {
      environmentId: string | null
      liveDocumentsByKey: Readonly<Record<string, SettingsDocument>>
      viewsByTabId: Readonly<Record<string, { tabId: string; documentKey: string; view: object }>>
      snapshotComparisons: ReadonlyMap<SettingsLease, SettingsRead>
    }
  }
  workspaceStore: { getState(): { rootFolder: { path: string } | null } }
  uiStore: { getState(): { controllersByTabId: ReadonlyMap<string, Controller> } }
}
type SettingsIdentity = {
  runtime: SettingsRuntime
  key: string
  tabId: string
  buffer: Buffer
  view: object
  controller: Controller
  native: NativeEditor
  root: { current: Fiber }
  ownerDocument: Document
  dom: { comparison: string; host: string }
}
type SettingsAttachment = {
  kind: 'settings'
  read: Extract<SettingsRead, { kind: 'ready' }>
  file: object
}
type SettingsBinding = { lease: SettingsLease; read: SettingsRead; file: object | null }

function captureSettingsIdentity(
  owner: NativeConflictOwner | null,
  dom: SettingsIdentity['dom'],
): SettingsIdentity | null {
  if (!owner) return null
  const isRuntime = (value: NativeConflictOwner['runtime']): value is SettingsRuntime =>
    'workspaceStore' in value &&
    Boolean(
      value.workspaceStore &&
      typeof value.workspaceStore === 'object' &&
      'getState' in value.workspaceStore &&
      typeof value.workspaceStore.getState === 'function',
    )
  if (!isRuntime(owner.runtime)) return null
  const runtime = owner.runtime
  const docs = runtime.documentStore.getState()
  const document = Object.values(docs.liveDocumentsByKey).find(
    (entry) => entry.target.kind === 'settings-json' && entry.target.target === 'user',
  )
  const view = Object.values(docs.viewsByTabId).find((entry) => entry.documentKey === document?.key)
  const controller = view ? runtime.uiStore.getState().controllersByTabId.get(view.tabId) : null
  const native = controller?.getEditor()
  if (!document || !view || !controller || !native || native.getInputElement() !== owner.element)
    return null
  return {
    runtime,
    key: document.key,
    tabId: view.tabId,
    buffer: document.buffer,
    view: view.view,
    controller,
    native,
    root: owner.root,
    ownerDocument: owner.ownerDocument,
    dom,
  }
}

function captureSettingsBinding(identity: SettingsIdentity | null): SettingsBinding | null {
  if (!identity) return null
  const member = [...identity.runtime.documentStore.getState().snapshotComparisons].find(
    ([, read]) =>
      read.kind === 'ready' && read.input.kind === 'settings' && read.input.key === identity.key,
  )
  if (!member) return null
  const queue: (Fiber | null)[] = [identity.root.current]
  while (queue.length) {
    const fiber = queue.pop()
    if (!fiber) continue
    queue.push(fiber.child, fiber.sibling)
    const attachment = fiber.memoizedProps?.attachment
    if (
      !attachment ||
      typeof attachment !== 'object' ||
      !('read' in attachment) ||
      attachment.read !== member[1] ||
      !('file' in attachment) ||
      !attachment.file ||
      typeof attachment.file !== 'object'
    )
      continue
    return { lease: member[0], read: member[1], file: attachment.file }
  }
  return { lease: member[0], read: member[1], file: null }
}

function observeSettings(
  identity: SettingsIdentity | null,
  captured: SettingsBinding | null = null,
) {
  if (!identity) return null
  const docs = identity.runtime.documentStore.getState()
  const document = docs.liveDocumentsByKey[identity.key]
  if (!document) return null
  const controller = identity.runtime.uiStore.getState().controllersByTabId.get(identity.tabId)
  const native = controller?.getEditor()
  if (!native || !controller) return null
  const nativeFacts = (editor: NativeEditor, owner: Controller) => {
    const input = editor.getInputElement()
    const rect = input.closest(identity.dom.host)?.getBoundingClientRect()
    const snapshot = editor.captureSnapshot()
    const paint = snapshot ? JSON.parse(snapshot.paint) : null
    return {
      connected: input.isConnected,
      focused: input === identity.ownerDocument.activeElement,
      editability: editor.getState().editability,
      documentId: editor.getState().documentId,
      presentation: editor.getPresentationState(),
      geometryCommitted: owner.getSnapshot()?.geometryCommitted ?? false,
      capturedCurrentPaint:
        snapshot !== null && snapshot.documentId === editor.getState().documentId,
      paintWidth: paint?.viewportWidth ?? 0,
      paintHeight: paint?.viewportHeight ?? 0,
      visibleText:
        paint?.rows
          .flatMap((row: { segments: readonly { text: string }[] }) => row.segments)
          .map((segment: { text: string }) => segment.text)
          .join('') ?? '',
      snapshotDocumentId: snapshot?.documentId,
      textVersion: snapshot?.textVersion,
      visibleRows: paint?.rows.length ?? 0,
      text: editor.materializeFullText(),
      rect: { width: rect?.width ?? 0, height: rect?.height ?? 0 },
      selections: editor.getSelections(),
      scroll: editor.getScrollPosition(),
    }
  }
  const read = [...docs.snapshotComparisons.values()].find(
    (entry) =>
      entry.kind === 'ready' && entry.input.kind === 'settings' && entry.input.key === identity.key,
  )
  const source =
    read?.kind === 'ready'
      ? {
          key: read.input.key,
          target: read.input.target,
          scope: read.input.scope,
          sameEnvironment: read.input.scope.environmentId === docs.environmentId,
          sameRoot:
            read.input.scope.rootPath ===
            identity.runtime.workspaceStore.getState().rootFolder?.path,
          local: {
            revision: read.input.local.revision,
            text: read.input.local.snapshot.materializeFullText(),
            exactBuffer: read.input.local.buffer === document.buffer,
            exactSnapshot: read.input.local.snapshot === document.buffer.getTextSnapshot(),
          },
          confirmedKind: read.input.confirmed.kind,
          confirmed:
            read.input.confirmed.kind === 'confirmed'
              ? {
                  revision: read.input.confirmed.revision,
                  text: read.input.confirmed.reader.materializeFullText(),
                }
              : null,
        }
      : null
  const isController = (value: unknown): value is Controller =>
    Boolean(
      value &&
      typeof value === 'object' &&
      'getEditor' in value &&
      typeof value.getEditor === 'function' &&
      'getSnapshot' in value &&
      typeof value.getSnapshot === 'function',
    )
  const isAttachment = (value: unknown): value is SettingsAttachment =>
    Boolean(
      value &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === 'settings' &&
      'read' in value &&
      'file' in value,
    )
  const queue: (Fiber | null)[] = [identity.root.current]
  let display = null
  while (queue.length) {
    const fiber = queue.pop()
    if (!fiber) continue
    queue.push(fiber.child, fiber.sibling)
    const candidate = fiber.memoizedProps?.controller
    if (!isController(candidate)) continue
    const diffNative = candidate.getEditor()
    if (!diffNative?.getState().documentId?.startsWith('projection:diff:')) continue
    let ancestor = fiber.return
    while (ancestor && !isAttachment(ancestor.memoizedProps?.attachment)) ancestor = ancestor.return
    const attachment = ancestor?.memoizedProps?.attachment
    if (!isAttachment(attachment)) continue
    const confirmed = attachment.read.input.confirmed
    display = {
      exactCurrentRead: attachment.read === read,
      exactCapturedRead: attachment.read === captured?.read,
      exactCapturedFile: attachment.file === captured?.file,
      exactCapturedReader:
        captured?.read.kind === 'ready' &&
        captured.read.input.confirmed.kind === 'confirmed' &&
        confirmed.kind === 'confirmed' &&
        confirmed.reader === captured.read.input.confirmed.reader,
      exactBuffer: attachment.read.input.local.buffer === document.buffer,
      local: {
        revision: attachment.read.input.local.revision,
        text: attachment.read.input.local.snapshot.materializeFullText(),
      },
      confirmed:
        confirmed.kind === 'confirmed'
          ? { revision: confirmed.revision, text: confirmed.reader.materializeFullText() }
          : null,
      native: nativeFacts(diffNative, candidate),
      scope: attachment.read.input.scope,
    }
  }
  const regionRect = identity.ownerDocument
    .querySelector(identity.dom.comparison)
    ?.getBoundingClientRect()
  return {
    sameNative: native === identity.native,
    sameController: controller === identity.controller,
    sameBuffer: document.buffer === identity.buffer,
    sameView: docs.viewsByTabId[identity.tabId]?.view === identity.view,
    bufferRevision: document.buffer.getRevision(),
    localText: document.buffer.materializeFullText(),
    sync: document.sync,
    sourceInterests: docs.snapshotComparisons.size,
    source,
    display,
    native: nativeFacts(native, controller),
    nativeUsesCurrentBuffer: native.getBufferSession()?.buffer === document.buffer,
    region: regionRect
      ? { top: regionRect.top, height: regionRect.height, width: regionRect.width }
      : null,
  }
}

async function waitForSettings(
  identity: JSHandle<SettingsIdentity | null>,
  accept: (facts: NonNullable<ReturnType<typeof observeSettings>>) => boolean,
) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const facts = await identity.evaluate(observeSettings, null)
    if (facts && accept(facts)) return facts
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw createScriptError(
    'Actual settings source and native comparison did not reach the expected state',
  )
}
