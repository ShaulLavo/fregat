import { scratchPath } from '../paths'
import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { JSHandle } from 'playwright'
import type { Evidence } from '../evidence'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { focusEditor, openFileFromTree, runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

const README = [
  '# Clobber',
  '',
  '<img name="getSelection" src="x.png" alt="x">',
  '',
  '<div id="main">raw id</div>',
  '',
  'Text.',
  '',
].join('\n')

export const markdownPreviewClobber: Scenario = {
  name: 'markdown-preview-clobber',
  description:
    'Previews a markdown file whose raw HTML names document properties, then types in its source: the document keeps getSelection and typing raises no page error.',
  async run(page, { step, evidence }) {
    const fixture = await mkdtemp(scratchPath('fregat-preview-clobber-'))
    const errors: string[] = []
    let owner: JSHandle<ReturnType<typeof captureMarkdownSource>> | null = null
    let operationError: { readonly error: unknown } | null = null
    const cleanupErrors: unknown[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await writeFile(path.join(fixture, 'readme.md'), README)
      await writeFile(path.join(fixture, 'other.md'), '# Different source buffer\n')
      await writeFile(
        path.join(fixture, 'x.png'),
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      )
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'other.md')
      await openFileFromTree(page, 'readme.md')
      await runPaletteCommand(page, 'Toggle Markdown rendered pane')
      await page.locator('[data-markdown-preview] h1').waitFor()
      await page.locator('[data-markdown-preview] img').waitFor({ state: 'attached' })
      await step('preview')
      const document = await page.evaluate(() => ({
        getSelection: typeof window.document.getSelection,
        imageName: window.document
          .querySelector('[data-markdown-preview] img')
          ?.getAttribute('name'),
        rawId: window.document.querySelector('[data-markdown-preview] [id$="main"]')?.id,
      }))
      deepStrictEqual(document, {
        getSelection: 'function',
        imageName: 'user-content-getSelection',
        rawId: 'user-content-main',
      })

      await focusEditor(page)
      await page.keyboard.press('Control+End')
      owner = await selectors.markdownRenderedPane(page).evaluateHandle(captureMarkdownSource)
      const observations: unknown[] = []
      const before = await recordMarkdownFacts(
        owner,
        evidence,
        observations,
        'known-good-shared-buffer',
      )
      const previewText = before.previewText
      ok(previewText, 'The visible preview supplies the known-good text observation')
      strictEqual(before.wrongBufferExists, true)
      strictEqual(before.wrongBufferExpectation, false)
      strictEqual(before.dirty, false)

      for (const label of ['alternate-source-mode', 'restored-rendered-mode']) {
        await runPaletteCommand(page, 'Cycle markdown view')
        const facts = await recordMarkdownFacts(owner, evidence, observations, label)
        strictEqual(facts.revision, before.revision)
        deepStrictEqual(facts.selections, before.selections)
        await step(label)
      }
      await runPaletteCommand(page, 'Toggle Markdown rendered pane')
      await selectors.markdownRenderedPane(page).waitFor({ state: 'hidden' })
      const closed = await recordMarkdownFacts(owner, evidence, observations, 'pane-closed')
      strictEqual(closed.previewVisible, false)
      strictEqual(closed.revision, before.revision)
      deepStrictEqual(closed.selections, before.selections)
      await step('pane-closed')
      await runPaletteCommand(page, 'Toggle Markdown rendered pane')
      await selectors.markdownRenderedPane(page).getByRole('heading', { name: 'Clobber' }).waitFor()
      const reopened = await recordMarkdownFacts(owner, evidence, observations, 'pane-reopened')
      strictEqual(reopened.sameScrollSync, true)
      strictEqual(reopened.seedPreviewConnected, false)
      deepStrictEqual(reopened.selections, before.selections)
      await step('pane-reopened')

      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.type('typed after preview', { delay: 20 })
      await page.keyboard.press('Shift+Home')
      await selectors
        .markdownRenderedPane(page)
        .getByText('typed after preview', { exact: false })
        .waitFor()
      const typed = await recordMarkdownFacts(
        owner,
        evidence,
        observations,
        'keyboard-edit-preview-caught-up',
      )
      ok(typed.revision > before.revision)
      strictEqual(typed.dirty, true)
      strictEqual(typed.text, README + 'typed after preview')
      strictEqual(typed.sameSnapshot, false)
      await step('typed')
      let previousRevision = typed.revision
      for (const suffix of ['typed after', 'typed', '']) {
        await page.keyboard.press('Control+z')
        await page.waitForFunction(markdownMatchesText, {
          source: owner,
          text: README + suffix,
          preview: previewText + (suffix ? `\n${suffix}` : ''),
        })
        const undone = await recordMarkdownFacts(
          owner,
          evidence,
          observations,
          `Undo-${suffix || 'clean'}`,
        )
        ok(undone.revision > previousRevision)
        previousRevision = undone.revision
        strictEqual(undone.text, README + suffix)
        strictEqual(undone.dirty, suffix !== '')
        deepStrictEqual(undone.selections, [
          [README.length + suffix.length, README.length + suffix.length],
        ])
        await step(`undo-${suffix || 'restored-source-and-preview'}`)
      }
      strictEqual(await readFile(path.join(fixture, 'readme.md'), 'utf8'), README)
      await step('undo-restored-source-and-preview')
      strictEqual(errors.join('\n'), '')
    } catch (error) {
      operationError = { error }
    } finally {
      try {
        await owner?.dispose()
      } catch (error) {
        cleanupErrors.push(error)
      }
      try {
        await releaseFixture(fixture)
      } catch (error) {
        cleanupErrors.push(error)
      }
      if (cleanupErrors.length)
        await Promise.resolve()
          .then(() => evidence.json('markdown-cleanup-errors.json', cleanupErrors.map(String)))
          .catch(() => undefined)
    }
    if (operationError) throw operationError.error
    if (cleanupErrors.length) throw cleanupErrors[0]
  },
}

type MarkdownFiber = {
  return: MarkdownFiber | null
  child: MarkdownFiber | null
  sibling: MarkdownFiber | null
  memoizedProps: Record<string, unknown>
  stateNode?: { current: MarkdownFiber }
}

type MarkdownDocument = {
  readonly key: string
  readonly buffer: MarkdownBuffer
  readonly target: unknown
}

type MarkdownBuffer = {
  getTextSnapshot(): { readonly length: number; readRange(start: number, end: number): string }
  getRevision(): number
  isDirty(): boolean
}

type MarkdownNativeEditor = {
  getBufferSession(): { readonly buffer: MarkdownBuffer; readonly view: object } | null
  getInputElement(): HTMLElement
  getSelections(): readonly { readonly anchorOffset: number; readonly headOffset: number }[]
  getPresentationState(): string
  getState(): { readonly documentId: string | null }
}

type MarkdownRuntime = {
  readonly documentStore: {
    getState(): {
      readonly liveDocumentsByKey: Readonly<Record<string, MarkdownDocument>>
      getLiveEditorDocument(key: string): MarkdownDocument | undefined
    }
  }
  readonly uiStore: {
    getState(): {
      readonly controllersByTabId: ReadonlyMap<string, { getEditor(): MarkdownNativeEditor | null }>
    }
  }
}

// A local handle retains actual references; it installs no page globals or application API.
function captureMarkdownSource(element: Element) {
  const isStore = (value: unknown): value is { getState(): unknown } =>
    Boolean(
      value &&
      typeof value === 'object' &&
      'getState' in value &&
      typeof value.getState === 'function',
    )
  const isRuntime = (value: unknown): value is MarkdownRuntime =>
    Boolean(
      value &&
      typeof value === 'object' &&
      'documentStore' in value &&
      'uiStore' in value &&
      isStore(value.documentStore) &&
      isStore(value.uiStore),
    )
  const key = Object.keys(element).find((candidate) => candidate.startsWith('__reactFiber$'))
  if (!key) return null
  let fiber: MarkdownFiber | null = Reflect.get(element, key)
  const filePath = (target: unknown): string | null => {
    if (!target || typeof target !== 'object' || !('kind' in target) || target.kind !== 'file')
      return null
    if (!('resource' in target) || !target.resource || typeof target.resource !== 'object')
      return null
    return 'path' in target.resource && typeof target.resource.path === 'string'
      ? target.resource.path
      : null
  }
  let runtime: MarkdownRuntime | null = null
  let preview: { buffer: unknown; sync: unknown; documentPath: string } | null = null
  while (fiber) {
    const props = fiber.memoizedProps
    if (isRuntime(props?.runtime)) runtime = props.runtime
    if (typeof props?.documentPath === 'string' && 'buffer' in props && 'sync' in props)
      preview = { buffer: props.buffer, sync: props.sync, documentPath: props.documentPath }
    if (!fiber.return) break
    fiber = fiber.return
  }
  if (!runtime || !preview || !fiber?.stateNode) return null
  const root = fiber.stateNode
  const previewPath = preview.documentPath
  const document = Object.values(runtime.documentStore.getState().liveDocumentsByKey).find(
    (entry) => filePath(entry.target) === previewPath,
  )
  if (!document || document.buffer !== preview.buffer) return null
  const current = [...runtime.uiStore.getState().controllersByTabId].find(
    ([, controller]) => controller.getEditor()?.getBufferSession()?.buffer === document.buffer,
  )
  if (!current) return null
  const [tab, controller] = current
  const native = controller.getEditor()
  const session = native?.getBufferSession()
  if (!native || !session) return null
  const buffer = document.buffer
  const snapshot = buffer.getTextSnapshot()
  const input = native.getInputElement()
  const wrong = Object.values(runtime.documentStore.getState().liveDocumentsByKey).find((entry) =>
    filePath(entry.target)?.endsWith('/other.md'),
  )
  const sync = preview.sync
  const path = preview.documentPath
  const owner = runtime
  const findPreview = (node: MarkdownFiber | null): { buffer: unknown; sync: unknown } | null => {
    if (!node) return null
    const props = node.memoizedProps
    if (props?.documentPath === path && 'buffer' in props)
      return { buffer: props.buffer, sync: props.sync }
    return findPreview(node.child) ?? findPreview(node.sibling)
  }
  const observe = () => {
    const live = owner.documentStore.getState().getLiveEditorDocument(document.key)
    const nowController = owner.uiStore.getState().controllersByTabId.get(tab)
    const nowNative = nowController?.getEditor()
    const nowSession = nowNative?.getBufferSession()
    const rendered = findPreview(root.current)
    const shown = input.ownerDocument.querySelector('[data-markdown-preview]')
    const nowSnapshot = buffer.getTextSnapshot()
    return {
      sameBuffer: live?.buffer === buffer,
      nativeBuffer: nowSession?.buffer === buffer,
      previewVisible: shown !== null,
      previewBuffer: rendered?.buffer === buffer,
      sameScrollSync: rendered?.sync === sync,
      sameController: nowController === controller,
      sameNative: nowNative === native,
      sameView: nowSession?.view === session.view,
      sameInput: nowNative?.getInputElement() === input,
      seedPreviewConnected: element.isConnected,
      wrongBufferExists: wrong !== undefined,
      wrongBufferExpectation: rendered?.buffer === wrong?.buffer,
      sameSnapshot: nowSnapshot === snapshot,
      revision: buffer.getRevision(),
      dirty: buffer.isDirty(),
      text: nowSnapshot.readRange(0, nowSnapshot.length),
      seedSnapshotText: snapshot.readRange(0, snapshot.length),
      selections: nowNative
        ?.getSelections()
        .map((selection) => [selection.anchorOffset, selection.headOffset]),
      presentation: nowNative?.getPresentationState(),
      documentId: nowNative?.getState().documentId,
      previewText: shown?.textContent,
    }
  }
  return { buffer, observe }
}

async function markdownFacts(owner: JSHandle<ReturnType<typeof captureMarkdownSource>>) {
  const facts = await owner.evaluate((value) => value?.observe())
  ok(facts, 'The actual Markdown source owner remains observable')
  return facts
}

function markdownMatchesText({
  source,
  text,
  preview,
}: {
  source: ReturnType<typeof captureMarkdownSource>
  text: string
  preview: string
}) {
  const facts = source?.observe()
  return facts?.text === text && facts?.previewText === preview
}

async function recordMarkdownFacts(
  owner: JSHandle<ReturnType<typeof captureMarkdownSource>>,
  evidence: Evidence,
  observations: unknown[],
  label: string,
) {
  const facts = await markdownFacts(owner)
  observations.push({ label, ...facts })
  await evidence.json('markdown-source-lifetime.json', observations)
  strictEqual(facts.sameBuffer, true)
  strictEqual(facts.nativeBuffer, true)
  strictEqual(facts.sameController, true)
  strictEqual(facts.sameNative, true)
  strictEqual(facts.sameView, true)
  strictEqual(facts.sameInput, true)
  if (facts.previewVisible) strictEqual(facts.previewBuffer, true)
  strictEqual(facts.seedSnapshotText, README)
  return facts
}
