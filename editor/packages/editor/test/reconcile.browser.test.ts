import { afterEach, describe, expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor } from '@singapore-editor/core/editor'
import { createPlugin, textInput, type EditorViewScope } from '@singapore-editor/core/extensions'
import {
  createPieceTableSnapshot,
  type EditorTextTransaction,
} from '@singapore-editor/core/document'
import {
  createTreeSitterSyntaxPlugin,
  createTreeSitterSyntaxProvider,
  createTreeSitterWorkerOwner,
} from '../../tree-sitter/src/index'
import { TYPESCRIPT_TREE_SITTER_LANGUAGE } from '../../tree-sitter-languages/src/index'
import '../src/style.css'

const editors: Editor[] = []
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const cleanup of cleanups.splice(0)) await cleanup()
  document.body.replaceChildren()
})

function mount(options: ConstructorParameters<typeof Editor>[1] = {}) {
  const host = document.createElement('div')
  host.id = 'reconciliation-proof'
  host.style.cssText = 'width:600px;height:160px;display:flex'
  document.body.append(host)
  const transactions: EditorTextTransaction[] = []
  let scope!: EditorViewScope
  const editor = new Editor(host, {
    defaultText: 'abc',
    ...options,
    plugins: (options.plugins ?? []).concat([
      createPlugin({
        name: 'reconciliation-proof',
        view(api) {
          scope = api
          api.onDidTransaction((event) => transactions.push(event))
        },
      }),
    ]),
  })
  editors.push(editor)
  return { editor, host, transactions, scope }
}

function paintedText(host: HTMLElement, decoration: boolean) {
  const text: string[] = []
  for (const [name, highlight] of CSS.highlights) {
    if (name.includes('-range-decoration-') !== decoration) continue
    for (const range of highlight) {
      if (!host.contains(range.startContainer)) continue
      const readable = document.createRange()
      readable.setStart(range.startContainer, range.startOffset)
      readable.setEnd(range.endContainer, range.endOffset)
      text.push(readable.toString())
    }
  }
  return text
}

const frames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

test(
  'reconciles remote text into real highlighting and a projected decoration',
  { timeout: 15_000 },
  async ({ annotate }) => {
    const worker = createTreeSitterWorkerOwner()
    cleanups.push(() => worker.dispose())
    const syntax = createTreeSitterSyntaxProvider({ workerOwner: worker })
    syntax.registerLanguage(TYPESCRIPT_TREE_SITTER_LANGUAGE)
    const { editor, host, scope, transactions } = mount({
      plugins: [createTreeSitterSyntaxPlugin(syntax)],
    })
    editor.setText('const answer = 1;', { languageId: 'typescript' })
    await expect.poll(() => paintedText(host, false)).toContain('const')
    const tracked = scope.view.trackRanges([{ start: 6, end: 12 }], {
      startBias: 'right',
      endBias: 'left',
    })
    scope.watch(textInput, () => {
      editor.setRangeDecorations(
        tracked.resolve().map((range) => ({
          ...range,
          style: { backgroundColor: '#465f54' },
        })),
      )
    })
    await expect.poll(() => paintedText(host, true)).toEqual(['answer'])
    transactions.length = 0
    const edits = [
      { from: 0, to: 5, text: 'let' },
      { from: 6, to: 6, text: 'remote_' },
    ]
    scope.reconcile(createPieceTableSnapshot('const answer = 1;'), [edits], { edits })
    await expect.poll(() => editor.getState().syntaxStatus).toBe('ready')
    await expect.poll(() => paintedText(host, false)).toContain('let')
    await expect.poll(() => paintedText(host, true)).toEqual(['answer'])
    expect(tracked.resolve()).toEqual([{ start: 11, end: 17 }])
    expect(editor.materializeFullText()).toBe('let remote_answer = 1;')
    expect(transactions).toHaveLength(0)
    await frames()
    await annotate(
      JSON.stringify({
        text: editor.materializeFullText(),
        decoration: tracked.resolve(),
        screenshot: await commands.proofViewportScreenshot(host.id),
      }),
      'reconciliation-proof',
    )
  },
)

describe.each(['textarea', 'edit-context'] as const)('%s exact transactions', (route) => {
  test('observes native typing, one IME commit, paste, commands and programmatic edits', async () => {
    const { editor, transactions } = mount({ inputRoute: route })
    await frames()
    editor.focus()
    editor.setSelection(3)
    await commands.proofType('x')
    expect(transactions).toHaveLength(1)
    expect(transactions[0]!.edits).toEqual([{ from: 3, to: 3, text: 'x' }])
    await commands.proofImeComposition('に')
    await commands.proofImeComposition('にほ')
    expect(transactions).toHaveLength(1)
    await commands.proofInsertText('日本')
    expect(transactions).toHaveLength(2)
    expect(transactions[1]!.edits).toEqual([{ from: 4, to: 4, text: '日本' }])
    const clipboard = new DataTransfer()
    clipboard.setData('text/plain', 'P\r\n')
    editor
      .getInputElement()
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }),
      )
    await expect.poll(() => transactions.length).toBe(3)
    expect(transactions[2]!.edits).toEqual([{ from: 6, to: 6, text: 'P\n' }])
    editor.dispatchCommand('deleteBackward')
    editor.edit({ from: 0, to: 0, text: '!' })
    editor.dispatchCommand('undo')
    editor.dispatchCommand('redo')
    expect(transactions.map((event) => event.origin)).toEqual([
      'local',
      'local',
      'local',
      'local',
      'local',
      'undo',
      'redo',
    ])
  })

  test('cleanly ends active composition before reconciling and ignores its late end', async () => {
    const { editor, host, scope, transactions } = mount({ inputRoute: route })
    await frames()
    editor.focus()
    editor.setSelection(1)
    await commands.proofImeComposition('候補')
    await frames()
    expect(editor.materializeFullText()).toBe('abc')
    scope.reconcile(createPieceTableSnapshot('abc'), [[{ from: 0, to: 0, text: 'R' }]], {
      edits: [{ from: 0, to: 0, text: 'R' }],
    })
    await frames()
    expect(host.querySelector('.editor-virtualized-composition')?.textContent ?? '').toBe('')
    editor
      .getInputElement()
      .dispatchEvent(new CompositionEvent('compositionend', { data: '候補', bubbles: true }))
    expect(editor.materializeFullText()).toBe('Rabc')
    expect(transactions).toHaveLength(0)
    expect(scope.getSelections()[0]!.headOffset).toBe(2)
    await commands.proofType('x')
    expect(editor.materializeFullText()).toBe('Raxbc')
    expect(transactions).toHaveLength(1)
  })
})
