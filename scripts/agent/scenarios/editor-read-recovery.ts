import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { chmod, mkdtemp, open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { scratchPath } from '../paths'
import { focusEditor, selectors } from '../selectors'
import type { Scenario } from './index'

export const editorReadRecovery: Scenario = {
  name: 'editor-read-recovery',
  description:
    'Retry initial and retained text read failures while preserving unsaved edits and undo.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const root = await mkdtemp(scratchPath('fregat-read-recovery-'))
    const file = path.join(root, 'retained.txt')
    try {
      await writeFile(file, 'retained text\n')
      await chmod(file, 0)
      await openFixtureWorkspace(page, root)
      await selectors.treeItem(page, 'retained.txt').click()
      await selectors.fileReadRetry(page).waitFor()
      await step('initial-read-failure')
      await chmod(file, 0o600)
      await selectors.fileReadRetry(page).click()
      await selectors.editorRows(page).filter({ hasText: 'retained text' }).waitFor()
      await step('initial-retry-recovered')

      const clean = await selectors.editorInput(page).first().evaluateHandle(retainedIdentity)
      const writer = await open(file, 'r+')
      try {
        await chmod(file, 0)
        await writer.writeFile('retained text\n')
      } finally {
        await writer.close()
      }
      await selectors.fileReadRetry(page).waitFor()
      await selectors.fileReadErrorHeader(page).waitFor()
      await selectors.editorRows(page).filter({ hasText: 'retained text' }).waitFor()
      deepStrictEqual(await clean.evaluate(checkRetainedIdentity), retainedChecks)
      await step('clean-refetch-failure-held')
      await chmod(file, 0o600)
      await selectors.fileReadRetry(page).click()
      await selectors.fileReadErrorHeader(page).waitFor({ state: 'detached' })
      deepStrictEqual(await clean.evaluate(checkRetainedIdentity), retainedChecks)
      await clean.dispose()
      await step('clean-retry-recovered')

      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText('unsaved local edit')
      await selectors.editorRows(page).filter({ hasText: 'unsaved local edit' }).waitFor()
      const dirty = await selectors.editorInput(page).first().evaluateHandle(retainedIdentity)
      strictEqual(await dirty.evaluate((identity) => identity?.dirty), true)
      const dirtyWriter = await open(file, 'r+')
      try {
        await chmod(file, 0)
        await dirtyWriter.writeFile('retained text\n')
      } finally {
        await dirtyWriter.close()
      }
      await selectors.fileReadErrorHeader(page).waitFor()
      await selectors.editorRows(page).filter({ hasText: 'unsaved local edit' }).waitFor()
      deepStrictEqual(await dirty.evaluate(checkRetainedIdentity), retainedChecks)
      await step('dirty-refetch-failure-held')
      await chmod(file, 0o600)
      await selectors.fileReadRetry(page).click()
      await selectors.fileReadErrorHeader(page).waitFor({ state: 'detached' })
      await selectors.editorRows(page).filter({ hasText: 'unsaved local edit' }).waitFor()
      deepStrictEqual(await dirty.evaluate(checkRetainedIdentity), retainedChecks)
      strictEqual(await readFile(file, 'utf8'), 'retained text\n')
      await step('dirty-retry-recovered')
      await focusEditor(page)
      await page.keyboard.press('Control+z')
      await selectors
        .editorRows(page)
        .filter({ hasText: 'unsaved local edit' })
        .waitFor({ state: 'hidden' })
      await page.keyboard.press('Control+y')
      await selectors.editorRows(page).filter({ hasText: 'unsaved local edit' }).waitFor()
      strictEqual(await readFile(file, 'utf8'), 'retained text\n')
      await dirty.dispose()
      await step('undo-redo-preserved')
    } finally {
      await chmod(file, 0o600)
      await page.goto('about:blank')
      await releaseFixture(root)
    }
  },
}

type RetainedDocument = {
  analysis: object
  buffer: object
  contentRevision: string
  key: string
  sync: object
}
type RetainedView = { documentKey: string; tabId: string; view: object }
type RetainedStore = {
  getState: () => {
    dirtyDocumentKeys: ReadonlySet<string>
    liveDocumentsByKey: Readonly<Record<string, RetainedDocument>>
    viewsByTabId: Readonly<Record<string, RetainedView>>
  }
}

const retainedChecks = {
  analysis: true,
  buffer: true,
  dirty: true,
  document: true,
  revision: true,
  sync: true,
  view: true,
}

// The fixture reads the owning provider through React's development fiber without adding an app-global probe.
function retainedIdentity(element: Element) {
  type Fiber = { return: Fiber | null; memoizedProps?: { value?: unknown } }
  let host: Element | null = element
  let fiber: Fiber | null = null
  while (host && !fiber) {
    const fiberKey = Object.keys(host).find((key) => key.startsWith('__reactFiber$'))
    if (fiberKey) fiber = (host as unknown as Record<string, Fiber>)[fiberKey]
    host = host.parentElement
  }
  while (fiber) {
    const store = fiber.memoizedProps?.value as RetainedStore | undefined
    if (typeof store?.getState === 'function') {
      const state = store.getState()
      const view = Object.values(state.viewsByTabId ?? {})[0]
      const document = view ? state.liveDocumentsByKey[view.documentKey] : null
      if (document)
        return { store, view, document, dirty: state.dirtyDocumentKeys.has(document.key) }
    }
    fiber = fiber.return
  }
  return null
}

function checkRetainedIdentity(identity: ReturnType<typeof retainedIdentity>) {
  if (!identity) return null
  const state = identity.store.getState()
  const document = state.liveDocumentsByKey[identity.document.key]
  const view = state.viewsByTabId[identity.view.tabId]
  return {
    analysis: document.analysis === identity.document.analysis,
    buffer: document.buffer === identity.document.buffer,
    dirty: state.dirtyDocumentKeys.has(document.key) === identity.dirty,
    document: document === identity.document,
    revision: document.contentRevision === identity.document.contentRevision,
    sync: document.sync === identity.document.sync,
    view: view.view === identity.view.view,
  }
}
