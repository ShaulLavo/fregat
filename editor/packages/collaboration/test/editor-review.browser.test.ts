import '../src/presence.css'
import { afterEach, expect, test } from 'vitest'
import { Editor } from '@singapore-editor/core/editor'
import {
  createTreeSitterReviewSyntax,
  resolveTreeSitterLanguageContribution,
} from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'
import { EditorRoom } from './editor-fixture'
import { createCollaborationPlugin } from '../src/plugin'
import type { MergeReviewSyntax } from '../src/merge-review'

let room: EditorRoom | undefined
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  room?.dispose()
  room = undefined
  for (const cleanup of cleanups.splice(0)) await cleanup()
  document.body.replaceChildren()
})
const line: MergeReviewSyntax = async (snapshot, ranges) =>
  ranges.map(() => [
    {
      startIndex: 0,
      endIndex: snapshot.length,
      type: 'line',
      languageId: 'text',
      hasErrors: false,
      signature: null,
      parent: null,
    },
  ])

async function settleView() {
  await document.fonts.ready
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}

async function hoverAction(label: string) {
  await expect.poll(() => room!.editors[0]!.dispatchCommand('editor.action.showHover')).toBe(true)
  expect(room!.editors[0]!.dispatchCommand('editor.action.showHover')).toBe(true)
  const hover = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
    (node) => !node.hidden,
  )
  expect(hover?.textContent).toContain('Base')
  expect(hover?.textContent).toContain('Theirs')
  expect(hover?.textContent).toContain('Yours')
  const button = [...hover!.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label,
  )
  expect(button).toBeDefined()
  button!.click()
}

async function marked() {
  await expect
    .poll(() => room!.connections.map(({ review }) => review!.marks.length))
    .toEqual([1, 1])
}
function concurrent() {
  for (let index = 0; index < 2; index++)
    room!.editors[index]!.edit({ from: 14, to: 15, text: String(index + 1) })
  room!.flush()
}

for (const keep of ['yours', 'theirs'] as const) {
  test(`the ${keep} resolution travels as an ordinary edit to every peer`, async () => {
    room = new EditorRoom(2, 'const value = 0;\n', true, { syntax: line })
    concurrent()
    await marked()
    await expect.poll(() => room!.host.querySelectorAll('.editor-merge-review-dot').length).toBe(2)
    expect(
      [...room.host.querySelectorAll('.editor-merge-review-dot')].every((dot) =>
        dot.closest('[data-editor-gutter-contribution="merge-review"]'),
      ),
    ).toBe(true)
    room.editors[0]!.focus()
    room.editors[0]!.setSelection(14, 14)
    await settleView()
    await hoverAction(`Keep ${keep}`)
    room.flush()
    await expect
      .poll(() => room!.texts())
      .toEqual(Array(2).fill(`const value = ${keep === 'yours' ? 1 : 2};\n`))
    for (const { document } of room.connections) {
      const history = document.exportHistory(document.genesis)!
      expect(history.at(-1)!.edit.change.kind).not.toBe('setEffects')
      expect(history.at(-1)!.outcome.kind).toBe('accepted')
    }
  })
}

test('keep both clears only the local review mark and hosts can add hover actions', async () => {
  let calls = 0
  room = new EditorRoom(2, 'const value = 0;\n', true, {
    syntax: line,
    onMergeReview: (unit, versions) => {
      expect(unit.type).toBe('line')
      expect(versions.authors).toHaveLength(2)
      return [
        {
          label: 'Host action',
          run: () => {
            calls++
          },
        },
      ]
    },
  })
  concurrent()
  await marked()
  const before = room.texts()
  room.editors[0]!.focus()
  room.editors[0]!.setSelection(14, 14)
  await settleView()
  await hoverAction('Host action')
  expect(calls).toBe(1)
  room.editors[0]!.focus()
  await settleView()
  await hoverAction('Keep both')
  expect(room.texts()).toEqual(before)
  expect(room.connections[0]!.review!.marks).toEqual([])
  expect(room.connections[1]!.review!.marks).toHaveLength(1)
})

test('uninstalled and uninterested plugins have no review work; one author never asks syntax', async () => {
  let calls = 0
  const syntax: MergeReviewSyntax = async (...args) => {
    calls++
    return line(...args)
  }
  createCollaborationPlugin({
    session: { peer: 'unused', document: 'unused', epoch: '1', room: 'unused', text: '' },
    transport: { send() {} },
    mergeReview: { syntax },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const sessionless = new Editor(host, { defaultText: 'const value = 0;\n' })
  cleanups.push(() => sessionless.dispose())
  sessionless.edit({ from: 14, to: 15, text: '1' })
  expect(host.querySelectorAll('.editor-merge-review-dot').length).toBe(0)
  expect(calls).toBe(0)
  room = new EditorRoom(2, 'const value = 0;\n')
  concurrent()
  expect(room.connections.every(({ review }) => review === undefined)).toBe(true)
  room.dispose()
  room = new EditorRoom(1, 'const value = 0;\n', false, { syntax })
  room.editors[0]!.edit({ from: 14, to: 15, text: '1' })
  room.flush()
  await room.connections[0]!.review!.idle()
  expect(calls).toBe(0)
})

test('production worker reviews confirmed and projected snapshots and releases every source', async () => {
  const descriptor = await resolveTreeSitterLanguageContribution(
    TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === 'typescript')!,
  )
  const errors: unknown[] = []
  room = new EditorRoom(2, 'const value = 0;\n', true, () => {
    const syntax = createTreeSitterReviewSyntax({
      languageId: 'typescript',
      languages: [descriptor],
    })
    cleanups.push(() => syntax.dispose())
    return { syntax, onError: (error) => errors.push(error) }
  })
  concurrent()
  await expect
    .poll(() => ({
      errors: errors.map(String),
      marks: room!.connections.map(({ review }) => review!.marks.length),
    }))
    .toEqual({ errors: [], marks: [1, 1] })
  expect(errors).toEqual([])
  const review = room.connections[0]!.review!
  expect(review.marks[0]!.unit.type).toBe('lexical_declaration')
  expect(review.versions(review.marks[0]!)!.base).toBe('const value = 0;')
  expect(review.resolve(review.marks[0]!, review.peer)).toBe(true)
  room.flush()
  await expect.poll(() => room!.texts()).toEqual(['const value = 1;\n', 'const value = 1;\n'])
})
