import { createHash } from 'node:crypto'

export const editors = ['singapore', 'monaco', 'codemirror']
export const sizes = [1, 10, 50, 100, 200]
export const line = 'export const value: number = 123; // deterministic TypeScript fixture\n'

export function fixture(mib) {
  const bytes = mib * 1024 * 1024
  return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes)
}

export function fixtureIdentity(mib) {
  const text = fixture(mib)
  return {
    mib,
    bytes: text.length,
    lines: Math.floor(text.length / line.length) + 1,
    sha256: createHash('sha256').update(text).digest('hex'),
  }
}

export function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
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
    font?.fontSize !== '14px' ||
    font?.lineHeight !== '20px' ||
    !/monospace/i.test(font?.fontFamily ?? '')
  )
    throw new RangeError(`Editor geometry differs from the protocol: ${JSON.stringify(geometry)}`)
}
