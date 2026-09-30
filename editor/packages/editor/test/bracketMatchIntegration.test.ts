import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBracketMatchPlugin } from '../src/bracketMatchPlugin'
import { Editor } from '../src/editor/Editor'
import {
  resetEditorInstanceCount,
  setEditorSyntaxSessionFactory,
  setHighlightRegistry,
} from '../src/public/testing'
import type { EditorPlugin, EditorViewSnapshot } from '../src/plugins'
import { createEmptySyntaxResult } from '../src/syntax/session'
import type { BracketInfo, EditorSyntaxResult, EditorSyntaxSession } from '../src/syntax/session'

/**
 * Proves the whole path the unit tests stop short of: a structural parse carrying brackets reaches
 * the view snapshot, the plugin reads it, and a highlight lands in the registry the renderer paints
 * from. Everything between is the real Editor.
 */

const TEXT = 'fn(a)\n'
const BRACKETS: readonly BracketInfo[] = [
  { char: '(', depth: 1, index: 2 },
  { char: ')', depth: 1, index: 4 },
]

const highlightsMap = new Map<string, unknown>()
const mockRegistry = {
  delete: (name: string) => highlightsMap.delete(name),
  set: (name: string, highlight: unknown) => {
    highlightsMap.set(name, highlight)
  },
}

class MockHighlight extends Set<Range> {}

describe('bracket match plugin inside a real editor', () => {
  let container: HTMLElement
  let editor: Editor
  let seenSnapshots: EditorViewSnapshot[]

  beforeEach(() => {
    highlightsMap.clear()
    seenSnapshots = []
    // @ts-expect-error — happy-dom has no Highlight constructor
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    setEditorSyntaxSessionFactory(() => bracketSyntaxSession())
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, {
      plugins: [createBracketMatchPlugin(), snapshotProbePlugin((s) => seenSnapshots.push(s))],
    })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
    setEditorSyntaxSessionFactory(undefined)
  })

  // The parse lands after openDocument resolves, so the brackets show up on the next update the
  // editor publishes rather than on the ones openDocument itself produced.
  it('carries parsed brackets into the view snapshot', async () => {
    await openDocument()

    editor.setSelection(3, 3)
    await flushMicrotasks()

    expect(seenSnapshots.at(-1)?.brackets).toEqual(BRACKETS)
  })

  it('registers a highlight when the caret is placed against a bracket', async () => {
    await openDocument()

    editor.setSelection(3, 3)
    await flushMicrotasks()

    expect(bracketHighlightNames()).toHaveLength(1)
  })

  it('removes the highlight when the caret moves off the pair', async () => {
    await openDocument()

    editor.setSelection(3, 3)
    await flushMicrotasks()
    // Asserted before moving so an empty result at the end proves removal, not absence.
    expect(bracketHighlightNames()).toHaveLength(1)

    editor.setSelection(1, 1)
    await flushMicrotasks()

    expect(bracketHighlightNames()).toHaveLength(0)
  })

  it('jumps the caret to the matching bracket through the command router', async () => {
    await openDocument()
    editor.setSelection(3, 3)
    await flushMicrotasks()

    expect(editor.dispatchCommand('editor.action.jumpToBracket')).toBe(true)
    // TEXT is a single line, so the caret landing past ')' is column 5.
    expect(editor.getState().cursor).toMatchObject({ column: 5, row: 0 })
  })

  async function openDocument(): Promise<void> {
    editor.openDocument({ documentId: 'main.ts', languageId: 'typescript', text: TEXT })
    await flushSyntaxDebounce()
  }
})

/** Records every view snapshot the editor publishes, so a test can inspect what plugins receive. */
function snapshotProbePlugin(record: (snapshot: EditorViewSnapshot) => void): EditorPlugin {
  return {
    name: 'test.snapshot-probe',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          dispose: () => undefined,
          update: (snapshot) => record(snapshot),
        }),
      }),
  }
}

function bracketHighlightNames(): readonly string[] {
  return [...highlightsMap.keys()].filter((name) => name.includes('bracket-match'))
}

function bracketSyntaxSession(): EditorSyntaxSession {
  const result: EditorSyntaxResult = { ...createEmptySyntaxResult(), brackets: BRACKETS }
  return {
    applyChange: async () => result,
    dispose: () => undefined,
    getResult: () => result,
    foldingSupport: 'supported',
    getSnapshotVersion: () => 0,
    getTokens: () => [],
    refresh: async () => result,
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function flushSyntaxDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 160))
  await flushMicrotasks()
}
