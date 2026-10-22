import type { Element, Nodes as HastNode, Root as HastRoot } from 'hast'
import type { InlineCode, Nodes as MdastNode } from 'mdast'
import type { CompileContext, Extension, Handle } from 'mdast-util-from-markdown'
import type {} from 'remark-gfm'
import type {} from 'remark-parse'
import type { SemanticInline } from 'tree-sitter-md'
import type { Processor } from 'unified'

import { cloneTree, sourcePoint } from './positions'
import type { TrackedText } from './repair-origin'

type CodeMap = Extract<SemanticInline, { type: 'code' }>['sourceMap']
type CodeRun = CodeMap['runs'][number]
type Token = Parameters<Handle>[0]
const literalSource = Symbol('inline code source')
declare module 'mdast' {
  interface Data {
    [literalSource]?: CodeMap
  }
}

export type CodeLineRun = Readonly<{
  from: number
  to: number
  firstLine: number
  lastLine: number
}>
export type CodeLines = Readonly<{ length: number; runs: readonly CodeLineRun[] }>
type Occurrence = Readonly<
  { value: string } & ({ kind: 'literal'; lines: CodeLines | null } | { kind: 'authored' })
>
export type CodeOccurrences = Map<string, Occurrence | null>
type Capture = { start: number; runs: CodeRun[]; value: string }
type ValueCursor = { readonly runs: readonly CodeRun[]; index: number }

function valueLength(run: CodeRun): number {
  return run.kind === 'copy' ? run.length : run.valueLength
}
function sourceLength(run: CodeRun): number {
  return run.kind === 'copy' ? run.length : run.sourceLength
}
function natural(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

export function attachInlineCodeSource(node: InlineCode, map: CodeMap): void {
  node.data ??= {}
  const runs: CodeRun[] = []
  for (const run of map.runs) appendCodeRun(runs, run)
  node.data[literalSource] = { ...map, runs }
}

function appendCodeRun(runs: CodeRun[], run: CodeRun): void {
  const previous = runs.at(-1)
  if (
    previous?.kind === 'copy' &&
    run.kind === 'copy' &&
    previous.valueStart + previous.length === run.valueStart &&
    previous.tokenOffset + previous.length === run.tokenOffset
  ) {
    runs[runs.length - 1] = { ...previous, length: previous.length + run.length }
    return
  }
  runs.push(run)
}

export function inlineCodeSource(node: InlineCode): CodeMap | null {
  const map = node.data?.[literalSource]
  const position = node.position
  if (!map || !position || map.value !== node.value) return null
  if (position.start.offset === undefined || position.end.offset === undefined) return null
  if (map.tokenLength !== position.end.offset - position.start.offset) return null
  let cursor = 0
  let sourceEnd = 0
  for (const run of map.runs) {
    if (!validRun(run, cursor, sourceEnd, map.tokenLength)) return null
    cursor += valueLength(run)
    sourceEnd = run.tokenOffset + sourceLength(run)
  }
  return cursor === node.value.length ? map : null
}

function validRun(run: CodeRun, cursor: number, sourceEnd: number, tokenLength: number): boolean {
  return (
    natural(run.valueStart) &&
    run.valueStart === cursor &&
    natural(valueLength(run)) &&
    valueLength(run) > 0 &&
    natural(run.tokenOffset) &&
    run.tokenOffset >= sourceEnd &&
    natural(sourceLength(run)) &&
    sourceLength(run) > 0 &&
    run.tokenOffset + sourceLength(run) <= tokenLength
  )
}

export function remarkInlineCodeSource(this: Processor): void {
  const captures = new WeakMap<CompileContext['config'], Capture>()
  const extension: Extension = { enter: { codeTextSequence: begin } }
  const data = this.data()
  data.fromMarkdownExtensions = (data.fromMarkdownExtensions ?? []).concat([extension])

  function begin(this: CompileContext): void {
    if (captures.has(this.config)) return
    const token = this.tokenStack.at(-1)?.[0]
    if (!token || token.type !== 'codeText') return
    installRecorder(this, token, captures)
  }
}

function installRecorder(
  context: CompileContext,
  token: Token,
  captures: WeakMap<CompileContext['config'], Capture>,
): void {
  const capture: Capture = { start: token.start.offset, runs: [], value: '' }
  captures.set(context.config, capture)
  const data = context.config.exit.codeTextData
  const eol = context.config.exit.lineEnding
  const code = context.config.exit.codeText
  context.config.exit.codeTextData = function (part) {
    recordToken(this, part, capture)
    return data?.call(this, part)
  }
  context.config.exit.lineEnding = function (part) {
    const node = this.stack.at(-1)
    if (
      node &&
      !this.data.atHardBreak &&
      !this.data.setextHeadingSlurpLineEnding &&
      this.config.canContainEols.includes(node.type)
    )
      recordToken(this, part, capture)
    return eol?.call(this, part)
  }
  context.config.exit.codeText = function (part) {
    this.config.exit.codeTextData = data
    this.config.exit.lineEnding = eol
    this.config.exit.codeText = code
    captures.delete(this.config)
    const node = this.stack.at(-2)
    const inTable = this.data.inTable
    const result = code?.call(this, part)
    if (node?.type === 'inlineCode') finishCapture(node, capture, part.end.offset, Boolean(inTable))
    return result
  }
}

function recordToken(context: CompileContext, token: Token, capture: Capture): void {
  const value = context.sliceSerialize(token)
  const length = token.end.offset - token.start.offset
  const extra = value.length - length
  const virtual = extra > 0 && token.start._bufferIndex === -1 && /^ +$/.test(value.slice(0, extra))
  if (virtual)
    appendCaptured(capture, value.slice(0, extra), token.start.offset - capture.start - 1, 1, true)
  const prefix = virtual ? extra : 0
  recordCopiedToken(capture, value.slice(prefix), token.start.offset - capture.start)
}

function recordCopiedToken(capture: Capture, value: string, offset: number): void {
  let cursor = 0
  for (const match of value.matchAll(/\uFFFD/g)) {
    appendCaptured(
      capture,
      value.slice(cursor, match.index),
      offset + cursor,
      match.index - cursor,
      false,
    )
    appendCaptured(capture, match[0], offset + match.index, 1, true)
    cursor = match.index + 1
  }
  appendCaptured(capture, value.slice(cursor), offset + cursor, value.length - cursor, false)
}

function appendCaptured(
  capture: Capture,
  value: string,
  tokenOffset: number,
  length: number,
  atom: boolean,
): void {
  if (!value.length) return
  const base = { valueStart: capture.value.length, tokenOffset }
  const run: CodeRun = atom
    ? { kind: 'atom', ...base, valueLength: value.length, sourceLength: length }
    : { kind: 'copy', ...base, length }
  capture.runs.push(run)
  capture.value += value
}

function finishCapture(node: InlineCode, capture: Capture, end: number, table: boolean): void {
  const runs = table ? unescapePipes(capture) : capture.runs
  attachInlineCodeSource(node, { value: node.value, tokenLength: end - capture.start, runs })
  if (
    (table
      ? capture.value.replace(/\\([\\|])/g, (all, escaped: string) => (escaped === '|' ? '|' : all))
      : capture.value) !== node.value
  )
    delete node.data?.[literalSource]
}

function unescapePipes(capture: Capture): CodeRun[] {
  const runs: CodeRun[] = []
  const cursor: ValueCursor = { runs: capture.runs, index: 0 }
  let start = 0
  let output = 0
  for (const match of capture.value.matchAll(/\\([\\|])/g)) {
    if (match[1] !== '|') continue
    appendValueSlice(runs, cursor, start, match.index, output)
    output += match.index - start
    const pieces = sliceValue(cursor, match.index, match.index + 2)
    const first = pieces[0]
    const last = pieces.at(-1)
    if (!first || !last) return []
    runs.push({
      kind: 'atom',
      valueStart: output,
      valueLength: 1,
      tokenOffset: first.tokenOffset,
      sourceLength: last.tokenOffset + sourceLength(last) - first.tokenOffset,
    })
    output += 1
    start = match.index + 2
  }
  appendValueSlice(runs, cursor, start, capture.value.length, output)
  return runs
}

function sliceValue(cursor: ValueCursor, from: number, to: number): CodeRun[] {
  const result: CodeRun[] = []
  if (from >= to) return result
  while (cursor.index < cursor.runs.length) {
    const run = cursor.runs[cursor.index]!
    if (run.valueStart >= to) break
    const limit = run.valueStart + valueLength(run)
    const start = Math.max(from, run.valueStart)
    const end = Math.min(to, limit)
    if (start < end) result.push(sliceRun(run, start, end))
    if (limit > to) break
    cursor.index += 1
  }
  return result
}

function sliceRun(run: CodeRun, start: number, end: number): CodeRun {
  return run.kind === 'copy'
    ? {
        kind: 'copy',
        valueStart: start,
        length: end - start,
        tokenOffset: run.tokenOffset + start - run.valueStart,
      }
    : { ...run, valueStart: start, valueLength: end - start }
}

function appendValueSlice(
  output: CodeRun[],
  cursor: ValueCursor,
  from: number,
  to: number,
  at: number,
): void {
  for (const run of sliceValue(cursor, from, to))
    output.push({ ...run, valueStart: at + run.valueStart - from })
}

function occurrenceKey(node: HastNode | MdastNode): string | null {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return start === undefined || end === undefined ? null : `${start}:${end}`
}

export function retainInlineCode(
  node: InlineCode,
  input: TrackedText,
  occurrences: CodeOccurrences,
): void {
  const key = occurrenceKey(node)
  if (!key) return
  const map = inlineCodeSource(node)
  const value = node.value.replace(/\r?\n|\r/g, ' ')
  const lines =
    map && matchesPreparedCode(node, map, input) ? composeCodeLines(node, map, input) : null
  occurrences.set(key, occurrences.has(key) ? null : { kind: 'literal', value, lines })
}

function matchesPreparedCode(node: InlineCode, map: CodeMap, input: TrackedText): boolean {
  const start = node.position!.start.offset! - input.window.start
  if (start < 0 || start + map.tokenLength > input.text.length) return false
  return map.runs.every(
    (run) =>
      run.kind !== 'copy' ||
      input.text.slice(start + run.tokenOffset, start + run.tokenOffset + run.length) ===
        map.value.slice(run.valueStart, run.valueStart + run.length),
  )
}

function composeCodeLines(node: InlineCode, map: CodeMap, input: TrackedText): CodeLines {
  const runs: CodeLineRun[] = []
  const tokenStart = node.position!.start.offset! - input.window.start
  const values: ValueCursor = { runs: map.runs, index: 0 }
  let cursor = 0
  let output = 0
  for (const match of map.value.matchAll(/\r?\n|\r/g)) {
    projectValue(runs, values, input, tokenStart, cursor, match.index, output, false)
    output += match.index - cursor
    projectValue(
      runs,
      values,
      input,
      tokenStart,
      match.index,
      match.index + match[0].length,
      output,
      true,
    )
    output += 1
    cursor = match.index + match[0].length
  }
  projectValue(runs, values, input, tokenStart, cursor, map.value.length, output, false)
  return { length: output + map.value.length - cursor, runs }
}

function projectValue(
  output: CodeLineRun[],
  cursor: ValueCursor,
  input: TrackedText,
  tokenStart: number,
  from: number,
  to: number,
  at: number,
  eol: boolean,
): void {
  for (const run of sliceValue(cursor, from, to)) {
    const start = tokenStart + run.tokenOffset
    const out = eol ? at : at + run.valueStart - from
    projectContribution(
      output,
      input,
      start,
      sourceLength(run),
      out,
      eol ? 1 : valueLength(run),
      eol || run.kind === 'atom',
      eol,
    )
  }
}

function projectContribution(
  output: CodeLineRun[],
  input: TrackedText,
  start: number,
  length: number,
  at: number,
  size: number,
  atom: boolean,
  eol: boolean,
): void {
  let cursor = 0
  for (const origin of input.slice(start, length)) {
    const units = origin.kind === 'copy' ? origin.source.length : origin.text.length
    if (origin.kind === 'copy') {
      const first = sourcePoint(input.window.text, origin.source.start, input.window.point).line
      const end = origin.source.start + origin.source.length - (eol ? 0 : 1)
      const last = sourcePoint(input.window.text, end, input.window.point).line
      appendLine(output, {
        from: atom ? at : at + cursor,
        to: atom ? at + size : at + cursor + units,
        firstLine: first,
        lastLine: last,
      })
    }
    cursor += units
  }
}

function appendLine(runs: CodeLineRun[], run: CodeLineRun): void {
  const previous = runs.at(-1)
  if (previous && previous.from === run.from && previous.to === run.to) {
    runs[runs.length - 1] = {
      ...run,
      firstLine: Math.min(previous.firstLine, run.firstLine),
      lastLine: Math.max(previous.lastLine, run.lastLine),
    }
    return
  }
  if (
    previous &&
    previous.to === run.from &&
    previous.firstLine === run.firstLine &&
    previous.lastLine === run.lastLine
  ) {
    runs[runs.length - 1] = { ...previous, to: run.to }
    return
  }
  runs.push(run)
}

function codeText(node: HastNode): string {
  if (node.type === 'text') return node.value
  return 'children' in node ? node.children.map(codeText).join('') : ''
}
function codes(node: HastNode): Element[] {
  const own = node.type === 'element' && node.tagName === 'code' ? [node] : []
  return 'children' in node ? own.concat(node.children.flatMap(codes)) : own
}

type SourceNode = Readonly<{
  type: MdastNode['type']
  value: string | null
  inline: InlineCode | null
  key: string
  start: number
  end: number
}>
export type CodeSources = Readonly<{
  nodes: ReadonlyMap<string, SourceNode | null>
  leaves: readonly SourceNode[]
}>
type Contribution = Readonly<{ source: string; signature: string }>
export type CodeProduction = {
  readonly sources: CodeSources
  readonly contributions: Map<string, Contribution>
}
type Interval = Readonly<{ start: number; end: number }>
type RawAuthority = Readonly<{
  raw: readonly Interval[]
  invalid: readonly Interval[]
  existing: ReadonlySet<string>
}>

function sourceKey(node: MdastNode): string | null {
  const bounds = occurrenceKey(node)
  return bounds ? `${node.type}:${bounds}` : null
}

export function captureCodeSources(root: MdastNode): CodeSources {
  const nodes = new Map<string, SourceNode | null>()
  const leaves: SourceNode[] = []
  captureSourceNode(root, nodes, leaves)
  leaves.sort((left, right) => left.start - right.start)
  return { nodes, leaves }
}

function captureSourceNode(
  node: MdastNode,
  nodes: Map<string, SourceNode | null>,
  leaves: SourceNode[],
): void {
  const key = sourceKey(node)
  if (key) {
    const source: SourceNode = {
      type: node.type,
      value: 'value' in node ? node.value : null,
      inline: node.type === 'inlineCode' ? cloneTree(node) : null,
      key,
      start: node.position!.start.offset!,
      end: node.position!.end.offset!,
    }
    nodes.set(key, nodes.has(key) ? null : source)
    if (!('children' in node) && node.type !== 'definition') leaves.push(source)
  }
  if (!('children' in node)) return
  for (const child of node.children) captureSourceNode(child, nodes, leaves)
}

export function codeSourcesInWindow(sources: CodeSources, start: number, end: number): CodeSources {
  const first = sourceIndex(sources.leaves, start)
  const last = sourceIndex(sources.leaves, end)
  return { nodes: sources.nodes, leaves: sources.leaves.slice(first, last) }
}

function sourceIndex(sources: readonly SourceNode[], offset: number): number {
  let low = 0
  let high = sources.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (sources[middle]!.start < offset) low = middle + 1
    else high = middle
  }
  return low
}

export function createCodeProduction(sources: CodeSources): CodeProduction {
  return { sources, contributions: new Map() }
}

function matchingSource(node: MdastNode, production: CodeProduction): SourceNode | null {
  const key = sourceKey(node)
  const source = key ? production.sources.nodes.get(key) : null
  if (!source || ('value' in node && node.value !== source.value)) return null
  return source
}

function contributionSignature(node: HastNode): string | null {
  const bounds = occurrenceKey(node)
  if (!bounds) return null
  if (node.type === 'text' || node.type === 'raw') return `${node.type}:${bounds}:${node.value}`
  if (node.type !== 'element') return null
  const value = node.tagName === 'code' ? codeText(node) : ''
  return `element:${node.tagName}:${bounds}:${value}`
}

export function retainProducedCode(
  from: MdastNode,
  node: HastNode,
  production: CodeProduction,
  input: TrackedText,
  occurrences: CodeOccurrences,
): void {
  const source = matchingSource(from, production)
  const signature = contributionSignature(node)
  if (!source || !signature) return
  production.contributions.set(signature, {
    source: source.key,
    signature,
  })
  if (node.type !== 'element' || node.tagName !== 'code') return
  if (source.inline && from.type === 'inlineCode') {
    if (!sameInlineSource(from, source.inline)) return
    retainInlineCode(source.inline, input, occurrences)
    return
  }
  if (source.type === 'code' || source.type === 'math' || source.type === 'inlineMath')
    retainAuthoredCode(node, occurrences)
}

function sameInlineSource(current: InlineCode, source: InlineCode): boolean {
  const left = current.data?.[literalSource]
  const right = source.data?.[literalSource]
  return Boolean(left && right && JSON.stringify(left) === JSON.stringify(right))
}

function retainAuthoredCode(node: Element, occurrences: CodeOccurrences): void {
  const key = occurrenceKey(node)
  if (!key) return
  occurrences.set(key, occurrences.has(key) ? null : { kind: 'authored', value: codeText(node) })
}

function inputContributions(node: HastNode, output: HastNode[]): void {
  if (node.type !== 'root') output.push(node)
  if (node.type === 'element' && node.tagName === 'code') {
    rawDescendants(node, output)
    return
  }
  if (!('children' in node)) return
  for (const child of node.children) inputContributions(child, output)
}

function rawDescendants(node: HastNode, output: HastNode[]): void {
  if (node.type === 'raw') output.push(node)
  if (!('children' in node)) return
  for (const child of node.children) rawDescendants(child, output)
}

function interval(node: HastNode): Interval | null {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return start === undefined || end === undefined ? null : { start, end }
}

export function prepareRawCodeAuthority(tree: HastRoot, production: CodeProduction): RawAuthority {
  const events: HastNode[] = []
  inputContributions(tree, events)
  const counts = new Map<string, number>()
  for (const node of events) {
    const signature = contributionSignature(node)
    if (signature) counts.set(signature, (counts.get(signature) ?? 0) + 1)
  }
  const expected = events.map((node) => {
    const signature = contributionSignature(node)
    const contribution = signature ? production.contributions.get(signature) : undefined
    return contribution && counts.get(contribution.signature) === 1 ? contribution : null
  })
  const intervals = contributionIntervals(events, expected)
  const invalid: Interval[] = []
  const raw: Interval[] = []
  const seen = new Set<string>()
  const existing = new Set<string>()
  for (const node of codes(tree)) {
    const key = occurrenceKey(node)
    if (key) existing.add(key)
  }
  let previous = 0
  for (let index = 0; index < events.length; index += 1) {
    const node = events[index]!
    const bounds = intervals[index]!
    const contribution = expected[index]
    if (!contribution) {
      invalidateContribution(invalid, bounds, node)
      continue
    }
    seen.add(contribution.source)
    if (node.type === 'element') continue
    if (bounds.start < previous) invalid.push({ start: bounds.start, end: previous })
    previous = bounds.end
    if (node.type === 'raw') raw.push(bounds)
  }
  for (const source of production.sources.leaves) {
    if (!seen.has(source.key)) invalid.push(source)
  }
  return { raw: mergedIntervals(raw), invalid: mergedIntervals(invalid), existing }
}

function invalidateContribution(output: Interval[], local: Interval, node: HastNode): void {
  output.push(local)
  const positioned = interval(node)
  if (positioned) output.push(positioned)
}

function contributionIntervals(
  events: readonly HastNode[],
  expected: readonly (Contribution | null)[],
): Interval[] {
  const after: number[] = []
  let end = Number.MAX_SAFE_INTEGER
  for (let index = events.length - 1; index >= 0; index -= 1) {
    after[index] = end
    const node = events[index]!
    const bounds = interval(node)
    if (bounds && expected[index] && node.type !== 'element') end = bounds.start
  }
  const result: Interval[] = []
  let start = 0
  for (let index = 0; index < events.length; index += 1) {
    const node = events[index]!
    const bounds = interval(node)
    const end = after[index]!
    const local = { start: Math.min(start, end), end: Math.max(start, end) }
    result.push(expected[index] && bounds ? bounds : local)
    if (bounds && expected[index] && node.type !== 'element') start = bounds.end
  }
  return result
}

function mergedIntervals(intervals: Interval[]): readonly Interval[] {
  intervals.sort((left, right) => left.start - right.start)
  const merged: Interval[] = []
  for (const next of intervals) {
    const previous = merged.at(-1)
    if (!previous || previous.end < next.start) {
      merged.push(next)
      continue
    }
    merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, next.end) }
  }
  return merged
}

function intervalBefore(intervals: readonly Interval[], point: number): Interval | undefined {
  let low = 0
  let high = intervals.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (intervals[middle]!.start <= point) low = middle + 1
    else high = middle
  }
  return intervals[low - 1]
}

export function retainRawCodeAuthority(
  tree: HastRoot,
  authority: RawAuthority,
  occurrences: CodeOccurrences,
): void {
  for (const node of codes(tree)) {
    const key = occurrenceKey(node)
    const bounds = interval(node)
    if (!key || !bounds || authority.existing.has(key)) continue
    const raw = intervalBefore(authority.raw, bounds.start)
    if (!raw || raw.end <= bounds.start) continue
    const invalid = intervalBefore(authority.invalid, bounds.end - 1)
    if (invalid && invalid.end > bounds.start) continue
    retainAuthoredCode(node, occurrences)
  }
}

function occurrenceCounts(nodes: readonly Element[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    const key = occurrenceKey(node)
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export function publishInlineCodeLines(tree: HastRoot, occurrences: CodeOccurrences): void {
  const surviving = codes(tree)
  const counts = occurrenceCounts(surviving)
  for (const node of surviving) {
    delete node.properties.dataSourceCodeLines
    publishOccurrence(node, occurrences, counts)
  }
}

function publishOccurrence(
  node: Element,
  occurrences: CodeOccurrences,
  counts: ReadonlyMap<string, number>,
): void {
  node.properties.dataSourceCodeLines = '0'
  const key = occurrenceKey(node)
  if (!key) return
  const occurrence = occurrences.get(key)
  if (!occurrence || counts.get(key) !== 1 || codeText(node) !== occurrence.value) return
  if (occurrence.kind === 'authored') {
    delete node.properties.dataSourceCodeLines
    return
  }
  if (occurrence.lines) node.properties.dataSourceCodeLines = encodeCodeLines(occurrence.lines)
}

export function encodeCodeLines(lines: CodeLines): string {
  return JSON.stringify(
    [lines.length].concat(
      lines.runs.flatMap((run) => [run.from, run.to, run.firstLine, run.lastLine]),
    ),
  )
}

export function decodeCodeLines(encoded: string, length: number): CodeLines | null {
  let value: unknown
  try {
    value = JSON.parse(encoded)
  } catch {
    return null
  }
  if (!numericArray(value) || value.length % 4 !== 1 || value[0] !== length || !natural(length))
    return null
  const runs: CodeLineRun[] = []
  let previous = 0
  for (let index = 1; index < value.length; index += 4) {
    const [from, to, firstLine, lastLine] = value.slice(index, index + 4)
    if (from < previous || to <= from || to > length || firstLine < 1 || lastLine < firstLine)
      return null
    runs.push({ from, to, firstLine, lastLine })
    previous = to
  }
  return { length, runs }
}

function numericArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && natural(item))
}
