import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { Editor } from '../src/editor'
import type { EditorCommandId } from '../src/editor/commands'
import { createDocumentSession, type DocumentSession } from '../src/public/document'
import { setHighlightRegistry } from '../src/public/testing'
import { createVisibleEditor } from './factories/visibleEditor'

/**
 * Edit-command latency on a 16M-unit document split into 128 pieces. Opt-in, because building the
 * document is slow: `bun run bench:edit-commands` prints the median of 7 dispatches per command.
 */

const SIZE = 16 * 1024 * 1024
const PIECES = 128
const RUNS = 7
const HEAD = 'function outer() {  \n  if (ready) {\n    return rareWord \n  }\n}\n'

type Case = {
  readonly name: string
  readonly command: EditorCommandId
  readonly setup: (session: DocumentSession, text: string, editor: Editor) => void
  readonly undo?: boolean
}

const CASES: readonly Case[] = [
  {
    name: 'Ctrl+D, second press',
    command: 'addNextOccurrence',
    setup: (session, text, editor) => {
      const at = text.indexOf('filler') + 2
      session.setSelections([{ anchor: at, head: at }])
      editor.dispatchCommand('addNextOccurrence')
    },
  },
  {
    name: 'Move selection to next find match',
    command: 'editor.action.moveSelectionToNextFindMatch',
    setup: (session, text) => select(session, text.indexOf('filler'), 6),
  },
  {
    name: 'Select all occurrences (2 matches)',
    command: 'editor.action.selectHighlights',
    setup: (session, text) => select(session, text.indexOf('rareWord'), 8),
  },
  {
    name: 'Trim trailing whitespace',
    command: 'editor.action.trimTrailingWhitespace',
    setup: (session) => select(session, 0, 0),
    undo: true,
  },
  {
    name: 'Reindent selected lines, row 3',
    command: 'editor.action.reindentselectedlines',
    setup: (session, text) => select(session, text.indexOf('return'), 0),
    undo: true,
  },
  {
    name: 'Reindent lines, whole document',
    command: 'editor.action.reindentlines',
    setup: (session) => select(session, 0, 0),
    undo: true,
  },
]

const editors: Editor[] = []

beforeEach(() => {
  vi.stubGlobal('Highlight', class extends Set<Range> {})
  setHighlightRegistry(new Map())
})

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
  setHighlightRegistry(undefined)
  vi.unstubAllGlobals()
})

it.runIf(process.env.EDIT_COMMAND_LATENCY)(
  'times edit commands on a fragmented 16M document',
  () => {
    const { editor, session, text } = open()
    const rows: string[] = []
    for (const entry of CASES) {
      const samples: number[] = []
      for (let run = 0; run < RUNS; run += 1) {
        // A fresh revision, so no retained string answers a whole-document read.
        const end = session.getSnapshot().length
        session.applyEdits([{ from: end, to: end, text: 'x' }])
        entry.setup(session, text, editor)
        const start = performance.now()
        editor.dispatchCommand(entry.command)
        samples.push(performance.now() - start)
        if (entry.undo) editor.dispatchCommand('undo')
      }
      rows.push(`${entry.name}: ${median(samples).toFixed(1)} ms`)
    }
    process.stdout.write(`edit command latency, median of ${RUNS}\n${rows.join('\n')}\n`)
    expect(rows).toHaveLength(CASES.length)
  },
  120_000,
)

function open(): { editor: Editor; session: DocumentSession; text: string } {
  const line = 'const filler = value + other;\n'
  const body = line.repeat(Math.floor((SIZE - HEAD.length * 2) / line.length))
  const text = `${HEAD}${body}${HEAD}`
  const session = createDocumentSession(text)
  const stride = Math.floor(body.length / PIECES)
  for (let index = 0; index < PIECES; index += 1) {
    const from = HEAD.length + index * stride + 1
    session.applyEdits([{ from, to: from + 1, text: 'o' }])
  }
  const container = document.createElement('div')
  document.body.append(container)
  const editor = createVisibleEditor(container, { tabSize: 2 })
  editors.push(editor)
  editor.attachSession(session, { languageId: 'typescript' })
  editor.focus()
  return { editor, session, text }
}

function select(session: DocumentSession, at: number, length: number): void {
  session.setSelections([{ anchor: at, head: at + length }])
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}
