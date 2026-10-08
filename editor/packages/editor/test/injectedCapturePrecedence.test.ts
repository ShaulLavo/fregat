import { expect, it } from 'vitest'
import { styleForTreeSitterCapture, treeSitterCapturesToEditorTokens } from '../src/syntax'

it.each([
  ['comment', 'keyword'],
  ['string.special', 'constant.character'],
])('paints injected %s content with its own %s capture', (parent, child) => {
  const tokens = treeSitterCapturesToEditorTokens([
    { startIndex: 0, endIndex: 10, captureName: parent },
    { startIndex: 2, endIndex: 6, captureName: child, injectionDepth: 1 },
  ])
  expect(tokens).toEqual([
    { start: 0, end: 2, style: styleForTreeSitterCapture(parent) },
    { start: 2, end: 6, style: styleForTreeSitterCapture(child) },
    { start: 6, end: 10, style: styleForTreeSitterCapture(parent) },
  ])
})

it('keeps lexical specificity within each injection level', () => {
  const tokens = treeSitterCapturesToEditorTokens([
    { startIndex: 0, endIndex: 10, captureName: 'comment' },
    { startIndex: 2, endIndex: 6, captureName: 'variable', injectionDepth: 2 },
    { startIndex: 2, endIndex: 6, captureName: 'type.builtin', injectionDepth: 1 },
    { startIndex: 3, endIndex: 4, captureName: 'keyword', injectionDepth: 2 },
  ])
  expect(tokens).toEqual([
    { start: 0, end: 2, style: styleForTreeSitterCapture('comment') },
    { start: 2, end: 3, style: styleForTreeSitterCapture('variable') },
    { start: 3, end: 4, style: styleForTreeSitterCapture('keyword') },
    { start: 4, end: 6, style: styleForTreeSitterCapture('variable') },
    { start: 6, end: 10, style: styleForTreeSitterCapture('comment') },
  ])
})
