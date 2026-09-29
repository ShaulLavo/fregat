import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Editor } from '@singapore-editor/core/editor'
import { VirtualizedTextView } from '@singapore-editor/core/testing'
import { createDiffEditorOptions, createDiffPlugin, createTextDiff, joinRenderLines } from '../src'

const editors: Editor[] = []
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240)
  // Paint admission compares the outer box, which happy-dom otherwise reports as 0 by 0.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(240)
})
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

test.each(['old', 'new', 'stacked'] as const)(
  'native %s diff paint restores gutters without constructing a document',
  (side) => {
    const plugin = createDiffPlugin({ mode: 'document', side, syntaxHighlight: false })
    const file = createTextDiff({
      oldFile: { path: 'a.ts', text: 'before\ncontext' },
      newFile: { path: 'a.ts', text: 'after\ncontext' },
    })
    plugin.setFile(file)
    const original = mount({
      ...createDiffEditorOptions(),
      documentKey: 'exact-diff',
      plugins: [plugin],
    })
    original.editor.setText(joinRenderLines(plugin.getRows()))
    expect(plugin.isSyntaxReady()).toBe(true)
    const snapshot = original.editor.captureSnapshot()
    expect(snapshot).not.toBeNull()
    if (!snapshot) return
    const restored = mount({
      ...createDiffEditorOptions(),
      documentKey: 'exact-diff',
      snapshot: snapshot.paint,
      presentationReady: false,
      plugins: [createDiffPlugin({ mode: 'document', side, syntaxHighlight: false })],
    })
    expect(restored.editor.getPresentationState()).toBe('provisional')
    expect(restored.editor.materializeFullText()).toBe('')
    const cells = (host: HTMLElement) =>
      Array.from(host.querySelectorAll('.editor-diff-gutter')).map((cell) => cell.textContent)
    expect(cells(restored.host)).toEqual(cells(original.host))
    expect(restored.host.querySelectorAll('[data-editor-provisional-row]').length).toBeGreaterThan(
      0,
    )
  },
)

function mount(options: ConstructorParameters<typeof Editor>[1]) {
  const host = document.createElement('div')
  document.body.append(host)
  const editor = new Editor(host, options)
  const view: unknown = Reflect.get(editor, 'view')
  if (view instanceof VirtualizedTextView) view.setScrollMetrics(0, 240, 640)
  editors.push(editor)
  return { host, editor }
}
