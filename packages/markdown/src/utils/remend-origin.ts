/*
 * Adapted from remend 1.3.1. Copyright 2023 Vercel, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Changed: producer-recorded origins and invocation-local sparse code lookup.
 * Original dist/index.js SHA256:
 * 3ab122d383b14e9b8974ea75ea392075ce412cd3f1868494c2dc8009e02d5b81
 */
import { copy, insert, rewrite, type ProducerPart, type TrackedText } from './repair-origin'

type IsCode = (text: string, offset: number) => boolean
type Handler = Readonly<{ name: string; handle: (input: TrackedText, code: IsCode) => TrackedText }>
const markerOnly = /^[\s_~*`]*$/
const listOnly = /^[\s]*[-*+][\s]+$/
const wordPattern = /[\p{L}\p{N}_]/u
const sentinel = '](streamdown:incomplete-link)'

type CodeInterval = Readonly<{ start: number; end: number }>
function codeLookup(): IsCode {
  let cached: { text: string; intervals: readonly CodeInterval[] } | undefined
  return (text, offset) => {
    if (!cached || cached.text !== text) cached = { text, intervals: buildCodeLookup(text) }
    const point = Math.min(offset, text.length)
    return cached.intervals.some((interval) => interval.start <= point && point < interval.end)
  }
}

function appendCodeInterval(intervals: CodeInterval[], start: number, end: number): void {
  const previous = intervals.at(-1)
  if (previous?.end === start) {
    intervals[intervals.length - 1] = { start: previous.start, end }
    return
  }
  intervals.push({ start, end })
}

function appendEscapedCodeInterval(
  intervals: CodeInterval[],
  offset: number,
  inline: boolean,
  block: boolean,
): void {
  if (inline || block) appendCodeInterval(intervals, offset + 1, offset + 3)
}

function appendFenceCodeInterval(
  intervals: CodeInterval[],
  offset: number,
  end: number,
  inline: boolean,
  block: boolean,
): void {
  if (inline || block) appendCodeInterval(intervals, offset + 1, end + 1)
}

function buildCodeLookup(text: string): readonly CodeInterval[] {
  const intervals: CodeInterval[] = []
  let inline = false
  let block = false
  let offset = 0
  while (offset < text.length) {
    if (text[offset] === '\\' && offset + 1 < text.length && text[offset + 1] === '`') {
      appendEscapedCodeInterval(intervals, offset, inline, block)
      offset += 2
      continue
    }
    if (text.substring(offset, offset + 3) === '```') {
      block = !block
      const end = Math.min(offset + 3, text.length)
      appendFenceCodeInterval(intervals, offset, end, inline, block)
      offset = end
      continue
    }
    if (!block && text[offset] === '`') inline = !inline
    if (inline || block) appendCodeInterval(intervals, offset + 1, offset + 2)
    offset += 1
  }
  return intervals
}

function tripleBacktick(text: string, offset: number): boolean {
  return (
    text.substring(offset, offset + 3) === '```' ||
    (offset > 0 && text.substring(offset - 1, offset + 2) === '```') ||
    (offset > 1 && text.substring(offset - 2, offset + 1) === '```')
  )
}

function withinClosedCode(text: string, offset: number): boolean {
  let inline = false
  let block = false
  let opening = -1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\\' && index + 1 < text.length && text[index + 1] === '`') {
      index += 1
      continue
    }
    if (text.substring(index, index + 3) === '```') {
      block = !block
      index += 2
      continue
    }
    if (block || text[index] !== '`') continue
    if (!inline) {
      inline = true
      opening = index
      continue
    }
    if (opening < offset && offset < index) return true
    inline = false
    opening = -1
  }
  return false
}

function word(char: string): boolean {
  if (!char) return false
  const code = char.charCodeAt(0)
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    wordPattern.test(char)
  )
}

function whitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n'
}
function hasMath(text: string): boolean {
  return text.includes('$') || text.includes('\\(') || text.includes('\\[')
}

type MathState = 'none' | 'inlineLatex' | 'blockLatex' | 'inlineDollar' | 'blockDollar'
function latexTransition(state: MathState, char: string): MathState | null {
  if (char === '[' && state === 'none') return 'blockLatex'
  if (char === ']' && state === 'blockLatex') return 'none'
  if (char === '(' && state === 'none') return 'inlineLatex'
  if (char === ')' && state === 'inlineLatex') return 'none'
  return null
}
function dollarTransition(state: MathState, double: boolean): MathState {
  if (double) return state === 'blockDollar' ? 'none' : 'blockDollar'
  if (state === 'blockDollar') return state
  return state === 'inlineDollar' ? 'none' : 'inlineDollar'
}
function withinMath(text: string, offset: number): boolean {
  let state: MathState = 'none'
  for (let index = 0; index < text.length && index < offset; index += 1) {
    if (text[index] === '\\' && text[index + 1] === '$') {
      index += 1
      continue
    }
    const next: MathState | null =
      text[index] === '\\' ? latexTransition(state, text[index + 1]) : null
    if (next !== null) {
      state = next
      index += 1
      continue
    }
    if (text[index] !== '$' || state === 'inlineLatex' || state === 'blockLatex') continue
    const double = text[index + 1] === '$'
    state = dollarTransition(state, double)
    if (double) index += 1
  }
  return state !== 'none'
}
function closingParenOnLine(text: string, offset: number): boolean {
  for (let index = offset; index < text.length; index += 1) {
    if (text[index] === ')') return true
    if (text[index] === '\n') return false
  }
  return false
}
function withinUrl(text: string, offset: number): boolean {
  for (let index = offset - 1; index >= 0; index -= 1) {
    if (text[index] === ')' || text[index] === '\n') return false
    if (text[index] === '(')
      return index > 0 && text[index - 1] === ']' ? closingParenOnLine(text, offset) : false
  }
  return false
}
function withinTag(text: string, offset: number): boolean {
  for (let index = offset - 1; index >= 0; index -= 1) {
    if (text[index] === '>' || text[index] === '\n') return false
    if (text[index] !== '<') continue
    const next = index + 1 < text.length ? text[index + 1] : ''
    return (next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z') || next === '/'
  }
  return false
}
function ruleLine(text: string, offset: number, marker: string): boolean {
  let start = 0
  let end = text.length
  for (let index = offset - 1; index >= 0; index -= 1) {
    if (text[index] === '\n') {
      start = index + 1
      break
    }
  }
  for (let index = offset; index < text.length; index += 1) {
    if (text[index] === '\n') {
      end = index
      break
    }
  }
  let count = 0
  for (const char of text.substring(start, end)) {
    if (char === marker) {
      count += 1
      continue
    }
    if (char !== ' ' && char !== '\t') return false
  }
  return count >= 3
}
function skipFencedCode(text: string, offset: number): number {
  while (text.startsWith('```', offset)) {
    const close = text.indexOf('```', offset + 3)
    if (close === -1) return text.length
    offset = close + 3
  }
  return offset
}
function countPairs(text: string, marker: string): number {
  let count = 0
  for (
    let index = skipFencedCode(text, 0);
    index < text.length;
    index = skipFencedCode(text, index + 1)
  ) {
    if (text[index] === marker && index + 1 < text.length && text[index + 1] === marker) {
      count += 1
      index += 1
    }
  }
  return count
}
function skipStar(text: string, index: number, previous: string, next: string): boolean {
  if (previous === '\\' || (hasMath(text) && withinMath(text, index))) return true
  if (previous !== '*' && next === '*')
    return (index < text.length - 2 ? text[index + 2] : '') !== '*'
  return previous === '*' || ((!previous || whitespace(previous)) && (!next || whitespace(next)))
}
function countStars(text: string): number {
  let count = 0
  let chain: boolean | undefined = false
  for (
    let index = skipFencedCode(text, 0);
    index < text.length;
    index = skipFencedCode(text, index + 1)
  ) {
    if (text[index] !== '*' && !word(text[index])) chain = false
    if (text[index] !== '*') continue
    const previous = index > 0 ? text[index - 1] : ''
    const next = index < text.length - 1 ? text[index + 1] : ''
    if (skipStar(text, index, previous, next)) continue
    const inWord = !!(previous && next && word(previous) && word(next))
    if (inWord && count % 2 === 0 && !chain) continue
    if ((!!previous && !whitespace(previous) && count % 2 === 1) || (!!next && !whitespace(next))) {
      count += 1
      chain = inWord
    }
  }
  return count
}
function countUnderscores(text: string): number {
  let count = 0
  for (
    let index = skipFencedCode(text, 0);
    index < text.length;
    index = skipFencedCode(text, index + 1)
  ) {
    if (text[index] !== '_') continue
    const previous = index > 0 ? text[index - 1] : ''
    const next = index < text.length - 1 ? text[index + 1] : ''
    if (
      previous === '\\' ||
      (hasMath(text) && withinMath(text, index)) ||
      withinUrl(text, index) ||
      withinTag(text, index) ||
      previous === '_' ||
      next === '_' ||
      (previous && next && word(previous) && word(next))
    )
      continue
    count += 1
  }
  return count
}
function countTriples(text: string): number {
  let count = 0
  let consecutive = 0
  let block = false
  for (let index = 0; index < text.length; index += 1) {
    const fence =
      text[index] === '`' &&
      index + 2 < text.length &&
      text[index + 1] === '`' &&
      text[index + 2] === '`'
    if (fence && consecutive >= 3) count += Math.floor(consecutive / 3)
    if (fence) {
      consecutive = 0
      block = !block
      index += 2
      continue
    }
    if (block) continue
    if (text[index] === '*') {
      consecutive += 1
      continue
    }
    if (consecutive >= 3) count += Math.floor(consecutive / 3)
    consecutive = 0
  }
  if (consecutive >= 3) count += Math.floor(consecutive / 3)
  return count
}
function firstSingle(text: string, marker: '*' | '_'): number {
  for (
    let index = skipFencedCode(text, 0);
    index < text.length;
    index = skipFencedCode(text, index + 1)
  ) {
    if (
      text[index] !== marker ||
      text[index - 1] === marker ||
      text[index + 1] === marker ||
      text[index - 1] === '\\' ||
      withinMath(text, index)
    )
      continue
    if (marker === '_' && withinUrl(text, index)) continue
    const previous = index > 0 ? text[index - 1] : ''
    const next = index < text.length - 1 ? text[index + 1] : ''
    if (previous && next && word(previous) && word(next)) continue
    if (marker === '*' && (!next || whitespace(next))) continue
    return index
  }
  return -1
}
function skipPair(text: string, content: string, offset: number, marker: string): boolean {
  if (!content || markerOnly.test(content)) return true
  const newline = text.substring(0, offset).lastIndexOf('\n')
  const line = text.substring(newline === -1 ? 0 : newline + 1, offset)
  return (listOnly.test(line) && content.includes('\n')) || ruleLine(text, offset, marker)
}
function emit(
  input: TrackedText,
  site: string,
  text: string,
  offset = input.text.length,
): TrackedText {
  return rewrite({
    input,
    owner: 'remend',
    site,
    parts: [copy(input, 0, offset), insert(input, text, offset), copy(input, offset)],
    expected: input.text.slice(0, offset) + text + input.text.slice(offset),
  })
}
function retainPrefix(input: TrackedText, site: string, end: number): TrackedText {
  return rewrite({
    input,
    owner: 'remend',
    site,
    parts: [copy(input, 0, end)],
    expected: input.text.substring(0, end),
  })
}

function escapeMatches(
  input: TrackedText,
  code: IsCode,
  pattern: RegExp,
  captureOffset: (match: RegExpMatchArray) => number,
  site: string,
): TrackedText {
  const text = input.text
  const parts: ProducerPart[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const offset = match.index + captureOffset(match)
    if (code(text, site === 'singleTilde.escape' ? offset : match.index)) continue
    parts.push(copy(input, cursor, offset - cursor), insert(input, '\\', offset))
    cursor = offset
  }
  if (!parts.length) return input
  parts.push(copy(input, cursor))
  const expected = text.replace(
    pattern,
    (whole: string, prefix: string, ...args: (string | number)[]) => {
      const offset = args.findLast((value) => typeof value === 'number')
      if (typeof offset !== 'number') return whole
      if (code(text, site === 'singleTilde.escape' ? offset + prefix.length : offset)) return whole
      return prefix + '\\' + whole.slice(prefix.length)
    },
  )
  return rewrite({ input, owner: 'remend', site, parts, expected })
}
function singleTilde(input: TrackedText, code: IsCode): TrackedText {
  if (!input.text || !input.text.includes('~')) return input
  return escapeMatches(
    input,
    code,
    /([\p{L}\p{N}_])~(?!~)(?=[\p{L}\p{N}_])/gu,
    (match) => match[1].length,
    'singleTilde.escape',
  )
}
function comparisonOperators(input: TrackedText, code: IsCode): TrackedText {
  if (!input.text || !input.text.includes('>')) return input
  return escapeMatches(
    input,
    code,
    /^(\s*(?:[-*+]|\d+[.)]) +)>(=?\s*[$]?\d)/gm,
    (match) => match[1].length,
    'comparisonOperators.escape',
  )
}
function htmlTags(input: TrackedText, code: IsCode): TrackedText {
  const match = input.text.match(/<[a-zA-Z/][^>]*$/)
  if (!match || match.index === undefined || code(input.text, match.index)) return input
  return retainPrefix(
    input,
    'htmlTags.trimSuffix',
    input.text.substring(0, match.index).trimEnd().length,
  )
}
function setextHeadings(input: TrackedText): TrackedText {
  const text = input.text
  if (!text) return input
  const newline = text.lastIndexOf('\n')
  if (newline === -1) return input
  const last = text.substring(newline + 1)
  const trimmed = last.trim()
  const previous = text.substring(0, newline).split('\n').at(-1)
  if (
    /^-{1,2}$/.test(trimmed) &&
    !last.match(/^[\s]*-{1,2}[\s]+$/) &&
    previous &&
    previous.trim().length > 0
  )
    return emit(input, 'setextHeadings.hyphen', '\u200B')
  if (
    /^={1,2}$/.test(trimmed) &&
    !last.match(/^[\s]*={1,2}[\s]+$/) &&
    previous &&
    previous.trim().length > 0
  )
    return emit(input, 'setextHeadings.equals', '\u200B')
  return input
}
function openingBracket(text: string, offset: number): number {
  let depth = 1
  for (let index = offset - 1; index >= 0; index -= 1) {
    if (text[index] === ']') depth += 1
    if (text[index] !== '[') continue
    depth -= 1
    if (depth === 0) return index
  }
  return -1
}
function closingBracket(text: string, offset: number): number {
  let depth = 1
  for (let index = offset + 1; index < text.length; index += 1) {
    if (text[index] === '[') depth += 1
    if (text[index] !== ']') continue
    depth -= 1
    if (depth === 0) return index
  }
  return -1
}
function incompleteUrl(input: TrackedText, offset: number, code: IsCode): TrackedText | null {
  const text = input.text
  if (text.substring(offset + 2).includes(')')) return null
  const open = openingBracket(text, offset)
  if (open === -1 || code(text, open)) return null
  if (open > 0 && text[open - 1] === '!') return retainPrefix(input, 'links.imageUrl', open - 1)
  return rewrite({
    input,
    owner: 'remend',
    site: 'links.url',
    parts: [
      copy(input, 0, offset + 2),
      insert(input, 'streamdown:incomplete-link)', offset + 2, text.length - offset - 2),
    ],
    expected: `${text.substring(0, open)}[${text.substring(open + 1, offset)}](streamdown:incomplete-link)`,
  })
}
function completeLabel(input: TrackedText, offset: number, nested: boolean): TrackedText {
  if (offset > 0 && input.text[offset - 1] === '!')
    return retainPrefix(input, nested ? 'links.nestedImageLabel' : 'links.imageLabel', offset - 1)
  return emit(input, nested ? 'links.nestedLabel' : 'links.label', sentinel)
}
function incompleteLabel(input: TrackedText, offset: number): TrackedText | null {
  const text = input.text
  if (!text.substring(offset + 1).includes(']')) return completeLabel(input, offset, false)
  if (closingBracket(text, offset) === -1) return completeLabel(input, offset, true)
  return null
}

function links(input: TrackedText, code: IsCode): TrackedText {
  const text = input.text
  const url = text.lastIndexOf('](')
  if (url !== -1 && !code(text, url)) {
    const result = incompleteUrl(input, url, code)
    if (result !== null) return result
  }
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (text[index] !== '[' || code(text, index)) continue
    const result = incompleteLabel(input, index)
    if (result !== null) return result
  }
  return input
}
function boldItalic(input: TrackedText, code: IsCode): TrackedText {
  const text = input.text
  if (/^\*{4,}$/.test(text)) return input
  const match = text.match(/(\*\*\*)([^*]*?)$/)
  if (!match) return input
  const content = match[2]
  const offset = text.lastIndexOf(match[1])
  if (
    !content ||
    markerOnly.test(content) ||
    code(text, offset) ||
    withinClosedCode(text, offset) ||
    ruleLine(text, offset, '*')
  )
    return input
  if (
    countTriples(text) % 2 !== 1 ||
    (countPairs(text, '*') % 2 === 0 && countStars(text) % 2 === 0)
  )
    return input
  return emit(input, 'boldItalic.close', '***')
}
function bold(input: TrackedText, code: IsCode): TrackedText {
  const text = input.text
  const match = text.match(/(\*\*)([^*]*\*?)$/)
  if (!match) return input
  const content = match[2]
  const offset = text.lastIndexOf(match[1])
  if (
    code(text, offset) ||
    withinClosedCode(text, offset) ||
    skipPair(text, content, offset, '*') ||
    countPairs(text, '*') % 2 !== 1
  )
    return input
  return emit(
    input,
    content.endsWith('*') ? 'bold.closePartial' : 'bold.close',
    content.endsWith('*') ? '*' : '**',
  )
}
function italicDoubleUnderscore(input: TrackedText, code: IsCode): TrackedText {
  const text = input.text
  const match = text.match(/(__)([^_]*?)$/)
  if (!match) {
    const partial = text.match(/(__)([^_]+)_$/)
    if (!partial) return input
    const offset = text.lastIndexOf(partial[1])
    if (code(text, offset) || withinClosedCode(text, offset) || countPairs(text, '_') % 2 !== 1)
      return input
    return emit(input, 'italicDoubleUnderscore.closePartial', '_')
  }
  const offset = text.lastIndexOf(match[1])
  if (
    code(text, offset) ||
    withinClosedCode(text, offset) ||
    skipPair(text, match[2], offset, '_') ||
    countPairs(text, '_') % 2 !== 1
  )
    return input
  return emit(input, 'italicDoubleUnderscore.close', '__')
}
function italicSingleAsterisk(input: TrackedText, code: IsCode): TrackedText {
  const text = input.text
  if (!text.match(/(\*)([^*]*?)$/)) return input
  const offset = firstSingle(text, '*')
  if (offset === -1 || code(text, offset) || withinClosedCode(text, offset)) return input
  const content = text.substring(offset + 1)
  if (!content || markerOnly.test(content) || countStars(text) % 2 !== 1) return input
  return emit(input, 'italicSingleAsterisk.close', '*')
}
function underscoreBeforeBold(input: TrackedText): TrackedText | null {
  const text = input.text
  if (!text.endsWith('**')) return null
  const prefix = text.slice(0, -2)
  if (countPairs(prefix, '*') % 2 !== 1) return null
  const boldOffset = prefix.indexOf('**')
  const underscoreOffset = firstSingle(prefix, '_')
  if (boldOffset === -1 || underscoreOffset === -1 || boldOffset >= underscoreOffset) return null
  return emit(input, 'italicSingleUnderscore.beforeBold', '_', prefix.length)
}
function underscoreBeforeNewlines(input: TrackedText): TrackedText {
  let end = input.text.length
  while (end > 0 && input.text[end - 1] === '\n') end -= 1
  return emit(
    input,
    end < input.text.length
      ? 'italicSingleUnderscore.beforeNewlines'
      : 'italicSingleUnderscore.close',
    '_',
    end,
  )
}
function italicSingleUnderscore(input: TrackedText, code: IsCode): TrackedText {
  const text = input.text
  if (!text.match(/(_)([^_]*?)$/)) return input
  const offset = firstSingle(text, '_')
  if (offset === -1) return input
  const content = text.substring(offset + 1)
  if (
    !content ||
    markerOnly.test(content) ||
    code(text, offset) ||
    withinClosedCode(text, offset) ||
    countUnderscores(text) % 2 !== 1
  )
    return input
  return underscoreBeforeBold(input) ?? underscoreBeforeNewlines(input)
}
function singleBacktickCount(text: string): number {
  let count = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\\' && index + 1 < text.length && text[index + 1] === '`') {
      index += 1
      continue
    }
    if (text[index] === '`' && !tripleBacktick(text, index)) count += 1
  }
  return count
}
function inlineCode(input: TrackedText): TrackedText {
  const text = input.text
  if (text.match(/^```[^`\n]*```?$/) && !text.includes('\n')) {
    if (text.endsWith('``') && !text.endsWith('```')) return emit(input, 'inlineCode.fence', '`')
    return input
  }
  const match = text.match(/(`)([^`]*?)$/)
  if (!match || (text.match(/```/g) || []).length % 2 === 1) return input
  const content = match[2]
  if (!content || markerOnly.test(content) || singleBacktickCount(text) % 2 !== 1) return input
  return emit(input, 'inlineCode.close', '`')
}
function strikethrough(input: TrackedText, code: IsCode): TrackedText {
  const text = input.text
  const match = text.match(/(~~)([^~]*?)$/)
  if (match) {
    if (!match[2] || markerOnly.test(match[2])) return input
    const offset = text.lastIndexOf(match[1])
    if (
      code(text, offset) ||
      withinClosedCode(text, offset) ||
      (text.match(/~~/g)?.length ?? NaN) % 2 !== 1
    )
      return input
    return emit(input, 'strikethrough.close', '~~')
  }
  const partial = text.match(/(~~)([^~]+)~$/)
  if (!partial) return input
  const offset = text.lastIndexOf(partial[0].slice(0, 2))
  if (
    code(text, offset) ||
    withinClosedCode(text, offset) ||
    (text.match(/~~/g)?.length ?? NaN) % 2 !== 1
  )
    return input
  return emit(input, 'strikethrough.closePartial', '~')
}
function blockDollarCount(text: string): number {
  let count = 0
  let inline = false
  for (let index = 0; index < text.length - 1; index += 1) {
    if (text[index] === '`' && !tripleBacktick(text, index)) inline = !inline
    if (!inline && text[index] === '$' && text[index + 1] === '$') {
      count += 1
      index += 1
    }
  }
  return count
}
function katex(input: TrackedText): TrackedText {
  const text = input.text
  if (blockDollarCount(text) % 2 === 0) return input
  if (text.endsWith('$') && !text.endsWith('$$')) return emit(input, 'katex.closePartial', '$')
  const opening = text.indexOf('$$')
  if (opening !== -1 && text.indexOf('\n', opening) !== -1 && !text.endsWith('\n'))
    return emit(input, 'katex.closeMultiline', '\n$$')
  return emit(input, 'katex.close', '$$')
}

const handlers: readonly Handler[] = Object.freeze([
  { name: 'singleTilde', handle: singleTilde },
  { name: 'comparisonOperators', handle: comparisonOperators },
  { name: 'htmlTags', handle: htmlTags },
  { name: 'setextHeadings', handle: setextHeadings },
  { name: 'links', handle: links },
  { name: 'boldItalic', handle: boldItalic },
  { name: 'bold', handle: bold },
  { name: 'italicDoubleUnderscore', handle: italicDoubleUnderscore },
  { name: 'italicSingleAsterisk', handle: italicSingleAsterisk },
  { name: 'italicSingleUnderscore', handle: italicSingleUnderscore },
  { name: 'inlineCode', handle: inlineCode },
  { name: 'strikethrough', handle: strikethrough },
  { name: 'katex', handle: katex },
])

export type RemendStep = Readonly<{ handler: string; input: TrackedText; output: TrackedText }>
function runDefaultRemend(input: TrackedText, observe?: (step: RemendStep) => void): TrackedText {
  if (!input.text) return input
  let result = input
  if (result.text.endsWith(' ') && !result.text.endsWith('  '))
    result = retainPrefix(result, 'trim.singleSpace', result.text.length - 1)
  const code = codeLookup()
  for (const handler of handlers) {
    const previous = result
    result = handler.handle(previous, code)
    observe?.({ handler: handler.name, input: previous, output: result })
    if (handler.name === 'links' && result.text.endsWith(sentinel)) return result
  }
  return result
}

export function remendWithOrigins(input: TrackedText): TrackedText {
  return runDefaultRemend(input)
}

export function inspectRemendOrigins(
  input: TrackedText,
): Readonly<{ result: TrackedText; steps: readonly RemendStep[] }> {
  const steps: RemendStep[] = []
  const result = runDefaultRemend(input, (step) => steps.push(Object.freeze(step)))
  return Object.freeze({ result, steps: Object.freeze(steps) })
}
