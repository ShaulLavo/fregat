/*
 * Resolver adapted from micromark-extension-cjk-friendly 2.0.1,
 * based on micromark-core-commonmark 2.0.4.
 *
 * Copyright (c) 2025 Tatsunori Uchino <tats.u@live.jp>
 *
 * MIT LICENSE
 *
 * Based on micromark and micromark-core-commonmark
 *
 * (The MIT License)
 *
 * Copyright (c) Titus Wormer <tituswormer@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * 'Software'), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import remarkCjkFriendly from 'remark-cjk-friendly'
import type { Data, Processor } from 'unified'

type Extension = NonNullable<Data['micromarkExtensions']>[number]
type ConstructValue = NonNullable<Extension['text']>[string]
type Construct = Exclude<ConstructValue, unknown[] | undefined>
type Resolver = NonNullable<Construct['resolveAll']>
type Events = Parameters<Resolver>[0]
type Context = Parameters<Resolver>[1]
type Token = Events[number][1]
type Point = Token['start']
type SpanConstruct = NonNullable<NonNullable<Extension['insideSpan']>['null']>[number]
type RunLengths = WeakMap<Token, number>

function remaining(token: Token): number {
  return token.end.offset - token.start.offset
}

function originalLength(token: Token, lengths: RunLengths): number {
  const original = lengths.get(token)
  if (original !== undefined) return original
  const length = remaining(token)
  lengths.set(token, length)
  return length
}

function move(point: Point, offset: number): Point {
  return {
    ...point,
    column: point.column + offset,
    offset: point.offset + offset,
    _bufferIndex: point._bufferIndex + offset,
  }
}

function sameMarker(opening: Token, closing: Token, context: Context): boolean {
  return (
    context.sliceSerialize(opening).charCodeAt(0) === context.sliceSerialize(closing).charCodeAt(0)
  )
}

function permitted(opening: Token, closing: Token, lengths: RunLengths): boolean {
  if (!opening._close && !closing._open) return true
  const openLength = originalLength(opening, lengths)
  const closeLength = originalLength(closing, lengths)
  return closeLength % 3 === 0 || (openLength + closeLength) % 3 !== 0
}

function findOpening(events: Events, index: number, context: Context, lengths: RunLengths): number {
  const closing = events[index][1]
  for (let open = index - 1; open >= 0; open--) {
    const [kind, opening] = events[open]
    if (kind !== 'exit' || opening.type !== 'attentionSequence' || !opening._open) continue
    if (sameMarker(opening, closing, context) && permitted(opening, closing, lengths)) return open
  }
  return -1
}

function resolveInside(events: Events, context: Context): Events {
  const called = new Set<Resolver>()
  for (const construct of context.parser.constructs.insideSpan.null ?? []) {
    const resolve = construct.resolveAll
    if (!resolve || called.has(resolve)) continue
    events = resolve(events, context)
    called.add(resolve)
  }
  return events
}

function pairEvents(opening: Token, closing: Token, inside: Events, context: Context): Events {
  const use = remaining(opening) > 1 && remaining(closing) > 1 ? 2 : 1
  const openingSequence: Token = {
    type: use === 2 ? 'strongSequence' : 'emphasisSequence',
    start: move(opening.end, -use),
    end: { ...opening.end },
  }
  const closingSequence: Token = {
    type: openingSequence.type,
    start: { ...closing.start },
    end: move(closing.start, use),
  }
  const text: Token = {
    type: use === 2 ? 'strongText' : 'emphasisText',
    start: { ...opening.end },
    end: { ...closing.start },
  }
  const group: Token = {
    type: use === 2 ? 'strong' : 'emphasis',
    start: { ...openingSequence.start },
    end: { ...closingSequence.end },
  }
  opening.end = { ...openingSequence.start }
  closing.start = { ...closingSequence.end }
  const prefix: Events = remaining(opening)
    ? [
        ['enter', opening, context],
        ['exit', opening, context],
      ]
    : []
  const start: Events = [
    ['enter', group, context],
    ['enter', openingSequence, context],
    ['exit', openingSequence, context],
    ['enter', text, context],
  ]
  const end: Events = [
    ['exit', text, context],
    ['enter', closingSequence, context],
    ['exit', closingSequence, context],
    ['exit', group, context],
  ]
  const suffix: Events = remaining(closing)
    ? [
        ['enter', closing, context],
        ['exit', closing, context],
      ]
    : []
  return prefix.concat(start, resolveInside(inside, context), end, suffix)
}

function replaceEvents(events: Events, start: number, count: number, replacement: Events): void {
  // Subtokenizers retain this array before write(), so replacement must preserve its identity.
  events.splice(start, count)
  for (let offset = 0; offset < replacement.length; offset += 10000) {
    events.splice(start + offset, 0, ...replacement.slice(offset, offset + 10000))
  }
}

function resolveAttention(events: Events, context: Context, lengths: RunLengths): Events {
  // Snapshot every token before consuming any span, including tokens later resolved recursively.
  for (const [, token] of events) {
    if (token.type === 'attentionSequence') originalLength(token, lengths)
  }
  for (let index = 0; index < events.length; index++) {
    const [kind, closing] = events[index]
    if (kind !== 'enter' || closing.type !== 'attentionSequence' || !closing._close) continue
    const open = findOpening(events, index, context, lengths)
    if (open < 0) continue
    const next = pairEvents(events[open][1], closing, events.slice(open + 1, index), context)
    replaceEvents(events, open - 1, index - open + 3, next)
    index = open + next.length - (remaining(closing) ? 2 : 0) - 2
  }
  for (const [, token] of events) {
    if (token.type === 'attentionSequence') token.type = 'data'
  }
  return events
}

function localTokenizer(original: Construct): Construct['tokenize'] {
  return function (effects, ok, nok) {
    const constructs = this.parser.constructs
    const markers = constructs.attentionMarkers.null ?? []
    const attentionMarkers = { null: markers.filter((code) => code !== 42 && code !== 95) }
    const context = {
      ...this,
      parser: { ...this.parser, constructs: { ...constructs, attentionMarkers } },
    }
    return original.tokenize.call(context, effects, ok, nok)
  }
}

function attentionExtension(extension: Extension): Extension {
  const lengths: RunLengths = new WeakMap()
  const locals = new Map<SpanConstruct, Construct>()
  const resolveAll: Resolver = (events, context) => resolveAttention(events, context, lengths)
  function local(original: Construct): Construct {
    const existing = locals.get(original)
    if (existing) return existing
    const construct = { ...original, tokenize: localTokenizer(original), resolveAll }
    locals.set(original, construct)
    return construct
  }
  function replace(value: ConstructValue): ConstructValue {
    if (!value) return value
    return Array.isArray(value) ? value.map(local) : local(value)
  }
  return {
    ...extension,
    text: {
      ...extension.text,
      42: replace(extension.text?.[42]),
      95: replace(extension.text?.[95]),
    },
    insideSpan: { null: extension.insideSpan?.null?.map((entry) => locals.get(entry) ?? entry) },
  }
}

export function remarkAttention(this: Processor): void {
  const data = this.data()
  const first = data.micromarkExtensions?.length ?? 0
  remarkCjkFriendly.call(this)
  data.micromarkExtensions = data.micromarkExtensions?.map((extension, index) =>
    index < first ? extension : attentionExtension(extension),
  )
}
