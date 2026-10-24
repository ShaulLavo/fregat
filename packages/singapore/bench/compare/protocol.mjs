import { createHash } from 'node:crypto'
import { fixture } from './fixture.mjs'

export const editors = ['singapore', 'monaco', 'codemirror']
export const sizes = [1, 10, 50, 100, 200]

export function fixtureIdentity(mib, corpus = 'repeated') {
  const text = fixture(mib, corpus)
  return {
    mib,
    corpus,
    bytes: Buffer.byteLength(text),
    utf16Length: text.length,
    lines: text.split('\n').length,
    sha256: createHash('sha256').update(text).digest('hex'),
  }
}

export function percentile(values, fraction) {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null
}

export function summarize(values) {
  return {
    n: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  }
}

export function order(repetition) {
  return editors.map((_, index) => editors[(index + repetition) % editors.length])
}

export function scrollTraceName(editor, mib) {
  return `${editor}-${mib}-scroll.trace.json.gz`
}

export function scrollCosts(events, frameStarts, thread) {
  const names = new Set([
    'FunctionCall',
    'RunMicrotasks',
    'EventDispatch',
    'Layout',
    'UpdateLayoutTree',
    'Paint',
    'PrePaint',
  ])
  const costs = frameStarts.slice(0, -1).map((start, index) => {
    const end = frameStarts[index + 1]
    const spans = events
      .filter(
        (event) =>
          event.ph === 'X' &&
          names.has(event.name) &&
          (!thread || (event.pid === thread.pid && event.tid === thread.tid)) &&
          event.ts < end &&
          event.ts + event.dur > start,
      )
      .map((event) => [Math.max(start, event.ts), Math.min(end, event.ts + event.dur)])
      .sort((a, b) => a[0] - b[0])
    let cost = 0
    let lastEnd = start
    for (const [from, to] of spans) {
      cost += Math.max(0, to - Math.max(from, lastEnd))
      lastEnd = Math.max(lastEnd, to)
    }
    return cost / 1000
  })
  return { names: [...names], ms: summarize(costs), samplesMs: costs }
}

export function verifyGeometry(open) {
  const geometry = open.geometry
  const font = geometry?.visibleStyle
  if (
    geometry?.width !== 1280 ||
    geometry?.height !== 720 ||
    geometry?.scrollViewport?.height < 690 ||
    geometry?.scrollViewport?.height > 720 ||
    !Number.isFinite(geometry?.scrollViewport?.height) ||
    geometry?.scrollViewport?.width < 1200 ||
    geometry?.scrollViewport?.width > 1280 ||
    !Number.isFinite(geometry?.scrollViewport?.width) ||
    !Number.isInteger(geometry?.renderedRows) ||
    geometry.renderedRows < 1 ||
    geometry.renderedRows > 300 ||
    font?.fontSize !== '14px' ||
    font?.lineHeight !== '20px' ||
    !/monospace/i.test(font?.fontFamily ?? '')
  )
    throw new RangeError(`Editor geometry differs from the protocol: ${JSON.stringify(geometry)}`)
}
