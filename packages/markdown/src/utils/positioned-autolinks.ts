/*
 * Text compile handlers adapted from mdast-util-from-markdown 2.0.3,
 * lib/index.js (onenterdata, onexitdata, onexitlineending,
 * onexitcharacterreference). Token correspondence and GFM transform wrapping
 * below are original adapters; GFM's matching and replacement run unchanged.
 *
 * (The MIT License)
 * Copyright (c) Titus Wormer <tituswormer@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the 'Software'), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import type { Nodes, Parents, Text } from 'mdast'
import type { Data, Processor } from 'unified'
import { visit } from 'unist-util-visit'

type Extension = Exclude<NonNullable<Data['fromMarkdownExtensions']>[number], unknown[]>
type Handle = NonNullable<Extension['enter']>[string]
type Context = ThisParameterType<Handle>
type Token = Parameters<Handle>[0]
type Point = Pick<Token['start'], 'line' | 'column' | 'offset'>
type Segment = {
  readonly value: string
  readonly start: Point
  readonly end: Point
  readonly atomic: boolean
}
type OpenText = { readonly token: Token; readonly length: number }
type Snapshot = { readonly parent: Parents; readonly children: readonly Nodes[] }

function point(value: Point): Point {
  return { line: value.line, column: value.column, offset: value.offset }
}

function textValue(node: Nodes): string | undefined {
  if (node.type === 'text') return node.value
  if (node.type !== 'link' || node.children.some((child) => child.type !== 'text')) return
  return node.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
}

function segmentPoint(segment: Segment, offset: number, end: boolean): Point {
  if (offset === 0) return segment.start
  if (offset === segment.value.length) return segment.end
  if (segment.atomic) return end ? segment.end : segment.start
  const prefix = segment.value.slice(0, offset)
  const lines = prefix.split(/\r\n|\r|\n/)
  return {
    line: segment.start.line + lines.length - 1,
    column: lines.length === 1 ? segment.start.column + offset : (lines.at(-1) ?? '').length + 1,
    offset: segment.start.offset + offset,
  }
}

function boundary(segments: readonly Segment[], offset: number, end: boolean): Point | undefined {
  let consumed = 0
  for (const segment of segments) {
    const limit = consumed + segment.value.length
    if (offset < limit || (end && offset === limit))
      return segmentPoint(segment, offset - consumed, end)
    consumed = limit
  }
  return offset === consumed ? segments.at(-1)?.end : undefined
}

function locate(node: Nodes, segments: readonly Segment[], offset: number): number {
  const value = textValue(node)
  if (value === undefined) return offset
  const start = boundary(segments, offset, false)
  const end = boundary(segments, offset + value.length, true)
  if (!node.position && start && end) node.position = { start: point(start), end: point(end) }
  if (node.type === 'link') {
    let childOffset = offset
    for (const child of node.children) childOffset = locate(child, segments, childOffset)
  }
  return offset + value.length
}

function restoreText(
  original: Text,
  output: readonly Nodes[],
  start: number,
  segments: readonly Segment[],
): number {
  let length = 0
  let index = start
  let value = ''
  while (index < output.length && length < original.value.length) {
    const fragment = textValue(output[index])
    if (fragment === undefined) return start
    value += fragment
    length += fragment.length
    index++
  }
  if (value !== original.value || segments.map((segment) => segment.value).join('') !== value)
    return start
  let offset = 0
  for (const node of output.slice(start, index)) offset = locate(node, segments, offset)
  return index
}

function restore(snapshot: Snapshot, correspondence: WeakMap<Text, Segment[]>) {
  let index = 0
  for (const original of snapshot.children) {
    if (original === snapshot.parent.children[index]) {
      index++
      continue
    }
    if (original.type !== 'text') return
    const segments = correspondence.get(original)
    if (!segments) return
    const next = restoreText(original, snapshot.parent.children, index, segments)
    if (next === index) return
    index = next
  }
}

function wrap(extension: Extension, correspondence: WeakMap<Text, Segment[]>) {
  if (!extension.enter?.literalAutolink || !extension.transforms) return
  extension.transforms = extension.transforms.map((transform) => (tree) => {
    const snapshots = new Map<Parents, Snapshot>()
    visit(tree, 'text', (_node, _index, parent) => {
      if (parent && !snapshots.has(parent))
        snapshots.set(parent, { parent, children: parent.children.slice() })
    })
    const result = transform(tree) ?? tree
    for (const snapshot of snapshots.values()) restore(snapshot, correspondence)
    return result
  })
}

export function remarkPositionedAutolinks(this: Processor) {
  const correspondence = new WeakMap<Text, Segment[]>()
  const opened = new WeakMap<Text, OpenText>()
  const extensions = this.data('fromMarkdownExtensions') ?? []
  for (const extension of extensions.flat()) wrap(extension, correspondence)

  function enterText(this: Context, token: Token) {
    const parent = this.stack.at(-1)
    if (!parent || !('children' in parent)) return
    const siblings: Nodes[] = parent.children
    const previous = siblings.at(-1)
    const node: Text = previous?.type === 'text' ? previous : { type: 'text', value: '' }
    if (node !== previous) {
      node.position = { start: point(token.start), end: point(token.start) }
      siblings.push(node)
    }
    opened.set(node, { token, length: node.value.length })
    this.stack.push(node)
  }

  function finishText(context: Context, token: Token, append: boolean) {
    const node = context.stack.pop()
    if (node?.type !== 'text') return
    const open = opened.get(node)
    if (append) node.value += context.sliceSerialize(token)
    if (node.position) node.position.end = point(token.end)
    if (!open) return
    const segments = correspondence.get(node) ?? []
    segments.push({
      value: node.value.slice(open.length),
      start: point(open.token.start),
      end: point(token.end),
      atomic: open.token.type === 'characterEscape' || open.token.type === 'characterReference',
    })
    correspondence.set(node, segments)
    opened.delete(node)
  }

  function exitText(this: Context, token: Token) {
    finishText(this, token, true)
  }

  function exitReference(this: Context, token: Token) {
    finishText(this, token, false)
  }

  function exitLineEnding(this: Context, token: Token) {
    const parent = this.stack.at(-1)
    if (!parent || !('children' in parent)) return
    if (this.data.atHardBreak) {
      const previous = parent.children.at(-1)
      if (previous?.position) previous.position.end = point(token.end)
      this.data.atHardBreak = undefined
      return
    }
    if (this.data.setextHeadingSlurpLineEnding || !this.config.canContainEols.includes(parent.type))
      return
    enterText.call(this, token)
    finishText(this, token, true)
  }

  extensions.push({
    enter: { data: enterText, characterEscape: enterText, characterReference: enterText },
    exit: {
      data: exitText,
      characterEscapeValue: exitText,
      characterReference: exitReference,
      lineEnding: exitLineEnding,
    },
  })
  this.data('fromMarkdownExtensions', extensions)
}
