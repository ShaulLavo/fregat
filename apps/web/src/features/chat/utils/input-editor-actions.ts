import { serializeComposerMention, splitComposerPrompt } from '@workspace/contracts'
import type { LexicalEditor, NodeKey } from 'lexical'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type LexicalNode,
} from 'lexical'

import { $createChatInputMentionNode } from '@/features/chat/components/chat-input-mention-node'

import {
  chatInputLineBoundaryOffset,
  chatInputRangeReplacement,
  type ChatInputLineEdge,
  type ChatInputRangeReplacement,
} from '@/features/chat/utils/input-logic'

type ChatInputPoint = {
  key: NodeKey
  offset: number
  type: 'element' | 'text'
}

export function $setChatInputText(text: string) {
  const root = $getRoot()
  root.clear()

  const paragraph = $createParagraphNode()
  for (const node of $chatInputPromptNodes(text)) {
    paragraph.append(node)
  }
  root.append(paragraph)
  paragraph.selectEnd()
}

/**
 * Inserts prompt text at the caret, mentions included: the text goes through
 * the grammar, so a serialized mention arrives as a chip instead of as the
 * characters it was written with. This is what a paste of a copied prompt runs
 * through.
 */
export function insertChatInputText(
  editor: LexicalEditor,
  text: string,
  { focus = false }: { focus?: boolean } = {},
) {
  let inserted = false

  editor.update(
    () => {
      // A composer that was never focused has no caret; the end of the prompt is
      // where handed-over text belongs, and without this it was dropped silently.
      if (!$isRangeSelection($getSelection())) $getRoot().selectEnd()
      inserted = $insertChatInputPrompt(text)
    },
    {
      // After the commit: focusing an editor whose DOM still lacks the insert
      // syncs that stale DOM back over it.
      onUpdate: () => {
        if (focus && inserted) editor.focus()
      },
    },
  )

  return inserted
}

/** Inserts one mention, plus the blank that separates it from what follows. */
export function insertChatInputMention(
  editor: LexicalEditor,
  path: string,
  options?: { focus?: boolean },
) {
  return insertChatInputText(editor, `${serializeComposerMention(path)} `, options)
}

export function clearChatInputEditor(editor: LexicalEditor) {
  editor.update(() => {
    $setChatInputText('')
  })
}

/** Reads through `editor.read`, which flushes updates a keystroke may still owe. */
export function readChatInputText(editor: LexicalEditor) {
  return editor.read(() => $readChatInputTextSnapshot().text)
}

/**
 * Splices a menu commit into the prompt through the selection rather than by
 * rewriting the document. Two things ride on that: the caret lands right after
 * the inserted text instead of at the end of the prompt, and the edit stays a
 * single undo step instead of collapsing the whole history.
 *
 * Returns `null` when the range is stale — see `chatInputRangeReplacement`.
 */
export function replaceChatInputEditorRange(
  editor: LexicalEditor,
  {
    expectedText,
    rangeEnd,
    rangeStart,
    replacement,
  }: {
    expectedText?: string
    rangeEnd: number
    rangeStart: number
    replacement: string
  },
): ChatInputRangeReplacement | null {
  // Declared explicitly: the only assignment happens inside `editor.update`, so
  // control-flow analysis would otherwise infer the return as plain `null`.
  let applied: ChatInputRangeReplacement | null = null

  editor.update(() => {
    const result = chatInputRangeReplacement({
      expectedText,
      rangeEnd,
      rangeStart,
      replacement,
      text: $getRoot().getTextContent(),
    })
    if (!result) return
    if (!$selectChatInputRange(result.rangeStart, result.rangeEnd)) return
    if (!$replaceChatInputSelection(replacement)) return

    applied = result
  })

  return applied
}

/** Wraps the selection in `open`/`close` and keeps the wrapped text selected. */
export function surroundChatInputSelection(editor: LexicalEditor, open: string, close: string) {
  let handled = false

  editor.update(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || selection.isCollapsed()) return

    const offsets = $chatInputSelectionOffsets()
    if (!offsets) return

    const start = Math.min(offsets.anchor, offsets.focus)
    const selected = offsets.text.slice(start, Math.max(offsets.anchor, offsets.focus))
    if (!selected) return

    const innerStart = start + open.length
    selection.insertText(`${open}${selected}${close}`)
    $selectChatInputRange(innerStart, innerStart + selected.length)
    handled = true
  })

  return handled
}

/** Home/End. Returns false when the caret is already on the boundary. */
export function moveChatInputCaretToLineBoundary(
  editor: LexicalEditor,
  edge: ChatInputLineEdge,
  extend: boolean,
) {
  let moved = false

  editor.update(() => {
    const offsets = $chatInputSelectionOffsets()
    if (!offsets) return

    const focus = chatInputLineBoundaryOffset(offsets.text, offsets.focus, edge)
    const anchor = extend ? offsets.anchor : focus
    if (anchor === offsets.anchor && focus === offsets.focus) return

    moved = $selectChatInputRange(anchor, focus)
  })

  return moved
}

export function $readChatInputTextSnapshot() {
  const text = $getRoot().getTextContent()
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return { cursor: text.length, text }
  if (!selection.isCollapsed()) return { cursor: text.length, text }

  return {
    cursor: textOffsetForLexicalPoint(selection.anchor, text.length),
    text,
  }
}

/**
 * Prose is spliced with `insertText` so the edit stays one undo step. Only a
 * replacement that carries a mention has to be built out of nodes, and it is
 * cleared first so the range it replaces is gone before the chip lands.
 */
function $replaceChatInputSelection(replacement: string) {
  const carriesMention = splitComposerPrompt(replacement).some(
    (segment) => segment.type === 'mention',
  )
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return false
  if (!carriesMention) {
    selection.insertText(replacement)

    return true
  }

  selection.insertText('')

  return $insertChatInputPrompt(replacement)
}

function $insertChatInputPrompt(text: string) {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return false

  const nodes = $chatInputPromptNodes(text)
  if (nodes.length === 0) return false

  selection.insertNodes(nodes)

  return true
}

function $chatInputPromptNodes(text: string) {
  const nodes: LexicalNode[] = []

  for (const segment of splitComposerPrompt(text)) {
    if (segment.type === 'mention') {
      nodes.push($createChatInputMentionNode(segment.path))
      continue
    }

    $appendChatInputTextNodes(nodes, segment.text)
  }

  return nodes
}

function $appendChatInputTextNodes(nodes: LexicalNode[], text: string) {
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    if (line.length > 0) nodes.push($createTextNode(line))
    if (index < lines.length - 1) nodes.push($createLineBreakNode())
  }
}

function $chatInputSelectionOffsets() {
  const text = $getRoot().getTextContent()
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return null

  return {
    anchor: textOffsetForLexicalPoint(selection.anchor, text.length),
    focus: textOffsetForLexicalPoint(selection.focus, text.length),
    text,
  }
}

function $selectChatInputRange(anchorOffset: number, focusOffset: number) {
  const anchor = $chatInputPointAtOffset(anchorOffset)
  const focus = $chatInputPointAtOffset(focusOffset)
  if (!anchor || !focus) return false

  const selection = $createRangeSelection()
  selection.anchor.set(anchor.key, anchor.offset, anchor.type)
  selection.focus.set(focus.key, focus.offset, focus.type)
  $setSelection(selection)

  return true
}

function $chatInputPointAtOffset(offset: number): ChatInputPoint | null {
  let start = 0

  for (const leaf of $chatInputLeaves()) {
    const size = lexicalNodeTextSize(leaf)
    if (offset > start + size) {
      start += size
      continue
    }

    return chatInputPointInLeaf(leaf, offset - start)
  }

  return $chatInputTailPoint()
}

/**
 * A line break carries no text offsets of its own, so an offset that lands on
 * one becomes an element point in the parent, before or after the break.
 */
function chatInputPointInLeaf(leaf: LexicalNode, localOffset: number): ChatInputPoint | null {
  if ($isTextNode(leaf)) return { key: leaf.getKey(), offset: localOffset, type: 'text' }

  const parent = leaf.getParent()
  if (!parent) return null

  const index = leaf.getIndexWithinParent()

  return {
    key: parent.getKey(),
    offset: localOffset > 0 ? index + 1 : index,
    type: 'element',
  }
}

/** Where an offset past the last leaf goes — including the empty-prompt case. */
function $chatInputTailPoint(): ChatInputPoint | null {
  const last = $getRoot().getLastChild()
  if (!$isElementNode(last)) return null

  return { key: last.getKey(), offset: last.getChildrenSize(), type: 'element' }
}

function $chatInputLeaves() {
  const leaves: LexicalNode[] = []
  collectChatInputLeaves($getRoot().getChildren(), leaves)

  return leaves
}

function collectChatInputLeaves(nodes: readonly LexicalNode[], leaves: LexicalNode[]) {
  for (const node of nodes) {
    if ($isElementNode(node)) {
      collectChatInputLeaves(node.getChildren(), leaves)
      continue
    }

    leaves.push(node)
  }
}

function textOffsetForLexicalPoint(
  point: { getNode: () => LexicalNode; offset: number },
  fallback: number,
) {
  const anchorNode = point.getNode()
  const root = $getRoot()
  const result = textOffsetInNode(root, anchorNode, point.offset, 0)

  return result.found ? result.offset : fallback
}

function textOffsetInNode(
  node: LexicalNode,
  anchorNode: LexicalNode,
  anchorOffset: number,
  offset: number,
): { found: boolean; offset: number } {
  if (node.getKey() === anchorNode.getKey()) {
    return {
      found: true,
      offset: offset + anchorOffsetInNode(node, anchorOffset),
    }
  }
  if (!$isElementNode(node)) return { found: false, offset: offset + lexicalNodeTextSize(node) }

  return textOffsetInChildren(node.getChildren(), anchorNode, anchorOffset, offset)
}

function textOffsetInChildren(
  children: LexicalNode[],
  anchorNode: LexicalNode,
  anchorOffset: number,
  offset: number,
) {
  let nextOffset = offset

  for (const child of children) {
    const result = textOffsetInNode(child, anchorNode, anchorOffset, nextOffset)
    if (result.found) return result

    nextOffset = result.offset
  }

  return { found: false, offset: nextOffset }
}

function anchorOffsetInNode(node: LexicalNode, anchorOffset: number) {
  if ($isElementNode(node)) return elementTextSizeBeforeOffset(node.getChildren(), anchorOffset)

  return anchorOffset
}

function elementTextSizeBeforeOffset(children: LexicalNode[], anchorOffset: number) {
  let size = 0
  const end = Math.max(0, Math.min(children.length, anchorOffset))

  for (let index = 0; index < end; index += 1) {
    const child = children[index]
    if (child) size += lexicalNodeTextSize(child)
  }

  return size
}

function lexicalNodeTextSize(node: LexicalNode): number {
  if ($isTextNode(node)) return node.getTextContentSize()
  if ($isLineBreakNode(node)) return 1
  // A chip occupies the width of the text it serializes to, or every offset
  // past it in the prompt would be short by that much.
  if ($isDecoratorNode(node)) return node.getTextContent().length
  if (!$isElementNode(node)) return 0

  return node.getChildren().reduce((size, child) => size + lexicalNodeTextSize(child), 0)
}
