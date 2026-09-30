import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Editor } from '@singapore-editor/core/editor'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import type { EditorKeymapOptions } from '@singapore-editor/core/keymap'
import { createDiffEditorOptions, createDiffPlugin, createTextDiff, joinRenderLines } from '../src'
import type { DiffFile, DiffPlugin } from '../src'
import { installHighlightPolyfill } from './support/highlightPolyfill'
import { createVisibleEditor } from './support/visibleEditor'

/**
 * An editor built from `createDiffEditorOptions()` plus the host's own typography, pushed the way
 * the README's recipe pushes. Each case fails if the preset loses the option it names.
 */

beforeAll(() => {
  installHighlightPolyfill()
})

const mounted: { editor: Editor; host: HTMLElement }[] = []

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.editor.dispose()
    entry.host.remove()
  }
})

describe('createDiffEditorOptions', () => {
  it('keeps the host tab width on every push', () => {
    const { plugin, tabSizes } = mountDiff(indentedDiff('  '))
    plugin.setFile(indentedDiff('    '))

    expect(tabSizes.length).toBeGreaterThan(0)
    expect(new Set(tabSizes)).toEqual(new Set([8]))
  })

  it('paints no cursor line over the diff tint', () => {
    const { editor, host } = mountDiff(indentedDiff('  '))
    editor.setSelection(1)

    expect(host.querySelector('.editor-virtualized-cursor-line-row')).toBeNull()
    // No gutter is mounted here, so the gutter parts are pinned on the value.
    expect(createDiffEditorOptions().cursorLineHighlight).toEqual({
      gutterBackground: false,
      gutterNumber: false,
      rowBackground: false,
    })
  })

  it('keeps reading keys and drops folding and editing keys', () => {
    const { editor, finds, host } = mountDiff(indentedDiff('  '))
    editor.setSelection(0)

    press(host, 'ArrowDown')
    press(host, 'ArrowDown', { shift: true })
    press(host, 'f', { mod: true })
    expect(editor.getState().cursor.row).toBe(2)
    expect(finds).toEqual(['find'])

    const text = visibleText(host)
    press(host, 'k', { mod: true })
    press(host, '0', { mod: true })
    press(host, 'Backspace')
    press(host, 'z', { mod: true })
    expect(visibleText(host)).toBe(text)
  })

  it('folds nothing when a host dispatches the fold commands', () => {
    const { editor, host } = mountDiff(indentedDiff('  '), { enabled: false })
    editor.setSelection(0)
    const text = visibleText(host)

    expect(editor.dispatchCommand('editor.foldAll')).toBe(false)
    expect(editor.dispatchCommand('editor.fold')).toBe(false)
    expect(editor.dispatchCommand('editor.foldLevel1')).toBe(false)
    expect(editor.dispatchCommand('editor.createFoldingRangeFromSelection')).toBe(false)
    expect(visibleText(host)).toBe(text)
  })

  it('refuses edits from a host keymap that binds them', () => {
    const { editor, host } = mountDiff(indentedDiff('  '), { defaultBindings: true })
    editor.setSelection(20)
    const { length } = editor.getState()

    press(host, 'Backspace')

    expect(editor.getState()).toMatchObject({
      documentMode: 'static',
      editability: 'readonly',
      isDirty: false,
      length,
    })
  })
})

/** `keymap` replaces the preset's, the way a host bringing its own bindings would. */
function mountDiff(
  file: DiffFile,
  keymap?: EditorKeymapOptions,
): {
  editor: Editor
  finds: string[]
  host: HTMLElement
  plugin: DiffPlugin
  tabSizes: number[]
} {
  const host = document.createElement('div')
  host.className = 'editor-diff-view'
  document.body.appendChild(host)

  const tabSizes: number[] = []
  const finds: string[] = []
  const plugin = createDiffPlugin({ mode: 'document', side: 'stacked', syntaxHighlight: false })
  const editor = createVisibleEditor(host, {
    ...createDiffEditorOptions(),
    ...(keymap ? { keymap } : {}),
    plugins: [plugin, tabSizeProbe(tabSizes), findProbe(finds)],
    tabSize: 8,
  })
  mounted.push({ editor, host })

  plugin.onDidChangeRows(() => {
    editor.setText(joinRenderLines(plugin.getRows()), { tokens: plugin.getTokens() })
  })
  plugin.setFile(file)
  return { editor, finds, host, plugin, tabSizes }
}

/** A block whose body changes, indented by `indent`, so an indentation guess has one to find. */
function indentedDiff(indent: string): DiffFile {
  const body = (value: string) =>
    `function f() {\n${indent}if (a) {\n${indent}${indent}${value}\n${indent}}\n}\n`
  return createTextDiff({
    oldFile: { path: 'note.ts', text: body('old()'), languageId: 'typescript' },
    newFile: { path: 'note.ts', text: body('new()'), languageId: 'typescript' },
  })
}

function tabSizeProbe(record: number[]): EditorPlugin {
  return {
    name: 'test.tab-size-probe',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          dispose: () => undefined,
          update: (snapshot) => {
            if (snapshot.lineCount > 1) record.push(snapshot.tabSize)
          },
        }),
      }),
  }
}

/** Stands in for the find plugin: records each `find` command a key dispatches. */
function findProbe(record: string[]): EditorPlugin {
  return {
    name: 'test.find-probe',
    activate: (context) =>
      context.registerCommandContribution({
        createContribution: (commands) =>
          commands.registerCommand('find', () => {
            record.push('find')
            return true
          }),
      }),
  }
}

/** The rows on screen; retired rows keep their last text, so the container itself is not enough. */
function visibleText(host: HTMLElement): string {
  const rows = host.querySelectorAll('.editor-virtualized-row[data-editor-virtual-row]')
  return [...rows].map((row) => row.textContent ?? '').join('\n')
}

function press(
  host: HTMLElement,
  key: string,
  chord: { readonly mod?: boolean; readonly shift?: boolean } = {},
): void {
  const mac = /mac/i.test(`${navigator.platform} ${navigator.userAgent}`)
  host.querySelector('.editor-virtualized')?.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      ctrlKey: chord.mod === true && !mac,
      metaKey: chord.mod === true && mac,
      shiftKey: chord.shift === true,
    }),
  )
}
