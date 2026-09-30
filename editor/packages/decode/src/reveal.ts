import type { EditorViewContributionContext } from '@singapore-editor/core/extensions'
import type { ResolvedDecodeOptions, DecodeMode } from './options'
import type { DecodeRevealRow } from './rows'
import { buildCarets, removeCarets } from './caret'
import { tokenizeLengths } from './tokenize'

const MIN_LINE_MS = 50
const MAX_LINE_MS = 1600

type ScheduleItem = {
  readonly delay: number
  readonly duration: number
}

export type RevealHandle = {
  cancel(): void
}

/**
 * Types the editor's real rows in via a per-line `clip-path` sweep with a caret
 * riding the reveal edge, so it reads as typing, not a smooth reveal. The step
 * granularity and start schedule vary by mode: `autoregressive`/`parallel` stamp
 * one *character* at a time (`steps(charCount)`, sequential vs. staggered);
 * `token` stamps one *token* at a time at a steady rate, sequential across rows,
 * like an LLM streaming. `onDone` fires once when the whole reveal settles
 * (never after `cancel`).
 */
export function runReveal(
  context: EditorViewContributionContext,
  rows: readonly DecodeRevealRow[],
  options: ResolvedDecodeOptions,
  onDone: () => void,
): RevealHandle {
  const schedule = buildSchedule(rows, options)
  const carets = buildCarets(context, rows)
  const animations = startAnimations(rows, carets.carets, schedule, options.mode)
  const completion = whenAllSettled(animations, onDone)

  return {
    cancel: () => {
      completion.cancel()
      for (const animation of animations) animation.cancel()
      removeCarets(carets)
    },
  }
}

function buildSchedule(
  rows: readonly DecodeRevealRow[],
  options: ResolvedDecodeOptions,
): readonly ScheduleItem[] {
  if (options.mode === 'parallel') return parallelSchedule(rows, options)
  if (options.mode === 'token') return tokenSchedule(rows, options)
  return autoregressiveSchedule(rows, options)
}

// Tokens stream at a steady rate (perTokenMs each), rows in order — so the row's
// duration is its token count times the per-token time, and rows run back to
// back. capSchedule keeps the whole thing within the cap (scaling the rate).
function tokenSchedule(
  rows: readonly DecodeRevealRow[],
  options: ResolvedDecodeOptions,
): readonly ScheduleItem[] {
  const items: ScheduleItem[] = []
  let cursor = 0
  for (const row of rows) {
    const count = Math.max(1, tokenizeLengths(row.text).length)
    const duration = count * options.perTokenMs
    items.push({ delay: cursor, duration })
    cursor += duration
  }
  return capSchedule(items, options.maxDurationMs)
}

function autoregressiveSchedule(
  rows: readonly DecodeRevealRow[],
  options: ResolvedDecodeOptions,
): readonly ScheduleItem[] {
  const items: ScheduleItem[] = []
  let cursor = 0
  for (const row of rows) {
    const duration = lineDuration(row.length, options.perCharMs)
    items.push({ delay: cursor, duration })
    cursor += duration
  }
  return capSchedule(items, options.maxDurationMs)
}

// Each line starts at a jittered offset and types at a slightly varied speed, so
// the reveal edges (and their carets) scatter across columns instead of advancing
// in lockstep — which is what makes a uniform "wipe" read as parallel typing.
// Jitter is a deterministic hash of the row index (no Math.random; stays testable).
function parallelSchedule(
  rows: readonly DecodeRevealRow[],
  options: ResolvedDecodeOptions,
): readonly ScheduleItem[] {
  const items = rows.map((row, index) => ({
    delay: startJitter(index) * options.staggerMs,
    duration: lineDuration(row.length, options.perCharMs) * speedFactor(index),
  }))
  return capSchedule(items, options.maxDurationMs)
}

function startJitter(index: number): number {
  return hash01(index * 12.9898 + 1.3)
}

function speedFactor(index: number): number {
  return 0.8 + 0.4 * hash01(index * 78.233 + 2.7)
}

/** Deterministic pseudo-random in [0, 1) from a seed (classic sine hash). */
function hash01(seed: number): number {
  const x = Math.sin(seed) * 43758.5453
  return x - Math.floor(x)
}

function lineDuration(length: number, perCharMs: number): number {
  return clamp(length * perCharMs, MIN_LINE_MS, MAX_LINE_MS)
}

/** Scale the whole schedule down so the slowest line still finishes within the cap. */
function capSchedule(items: readonly ScheduleItem[], cap: number): readonly ScheduleItem[] {
  let maxEnd = 0
  for (const item of items) maxEnd = Math.max(maxEnd, item.delay + item.duration)
  if (maxEnd <= cap || maxEnd === 0) return items

  const factor = cap / maxEnd
  return items.map((item) => ({ delay: item.delay * factor, duration: item.duration * factor }))
}

function startAnimations(
  rows: readonly DecodeRevealRow[],
  carets: readonly HTMLElement[],
  schedule: readonly ScheduleItem[],
  mode: DecodeMode,
): Animation[] {
  if (!supportsWaapi(rows)) return []

  const animations: Animation[] = []
  rows.forEach((row, index) => {
    const item = schedule[index]
    if (!item) return
    appendRowAnimations(animations, row, carets[index], item, mode)
  })
  return animations
}

function appendRowAnimations(
  animations: Animation[],
  row: DecodeRevealRow,
  caret: HTMLElement | undefined,
  item: ScheduleItem,
  mode: DecodeMode,
): void {
  if (mode === 'token') {
    appendTokenRow(animations, row, caret, item)
    return
  }
  appendCharRow(animations, row, caret, item)
}

// One step per character: each step stamps exactly one glyph's width.
function appendCharRow(
  animations: Animation[],
  row: DecodeRevealRow,
  caret: HTMLElement | undefined,
  item: ScheduleItem,
): void {
  const easing = `steps(${Math.max(1, row.length)}, end)`
  animations.push(animateClip(row.element, row.width, item, easing, row.leftSpacerWidth))
  if (!caret) return
  animations.push(animateCaretTravel(caret, row.width, item, easing))
  animations.push(animateCaretOpacity(caret, item))
}

// One step per token: the clip (and caret) jump by a whole token's width each
// step via explicit step-end keyframes at the token boundaries.
function appendTokenRow(
  animations: Animation[],
  row: DecodeRevealRow,
  caret: HTMLElement | undefined,
  item: ScheduleItem,
): void {
  const stops = tokenStops(row)
  animations.push(animateSteppedClip(row.element, stops, item, row.leftSpacerWidth))
  if (!caret) return
  animations.push(animateSteppedCaret(caret, stops, item))
  animations.push(animateCaretOpacity(caret, item))
}

// Cumulative px width at each token boundary. Monospace, so px is proportional
// to the character offset — no per-token measurement needed. Last stop is the
// full row width.
function tokenStops(row: DecodeRevealRow): number[] {
  const lengths = tokenizeLengths(row.text)
  const stops: number[] = []
  let chars = 0
  for (const length of lengths) {
    chars += length
    stops.push((row.width * chars) / Math.max(1, row.length))
  }
  if (stops.length === 0) stops.push(row.width)
  return stops
}

// Reveal the row up to its real text width: `calc(100% - widthpx)` clips the
// right side down to exactly the last glyph. Stepped, so it stamps per character.
function animateClip(
  element: HTMLElement,
  width: number,
  item: ScheduleItem,
  easing: string,
  left: number,
): Animation {
  return element.animate(
    [
      { clipPath: `inset(0 calc(100% - ${left}px) 0 0)` },
      { clipPath: `inset(0 calc(100% - ${left + width}px) 0 0)` },
    ],
    { duration: item.duration, delay: item.delay, easing, fill: 'both' },
  )
}

// Token reveal: hold each cumulative width, then jump to the next at the token
// boundary (`step-end` per keyframe). Equal time per token (uniform offsets), so
// it streams at a steady rate even though tokens differ in width.
function animateSteppedClip(
  element: HTMLElement,
  stops: readonly number[],
  item: ScheduleItem,
  left: number,
): Animation {
  const frames = steppedFrames(stops, (width) => ({
    clipPath: `inset(0 calc(100% - ${left + width}px) 0 0)`,
  }))
  return element.animate(
    [{ clipPath: `inset(0 calc(100% - ${left}px) 0 0)`, offset: 0, easing: 'step-end' }, ...frames],
    {
      duration: item.duration,
      delay: item.delay,
      fill: 'both',
    },
  )
}

function animateSteppedCaret(
  caret: HTMLElement,
  stops: readonly number[],
  item: ScheduleItem,
): Animation {
  const frames = steppedFrames(stops, (width) => ({ transform: `translateX(${width}px)` }))
  return caret.animate([{ transform: 'translateX(0)', offset: 0, easing: 'step-end' }, ...frames], {
    duration: item.duration,
    delay: item.delay,
    fill: 'both',
  })
}

// One keyframe per stop at equally-spaced offsets, each holding (step-end) until
// the next boundary. The final stop lands on offset 1.
function steppedFrames(
  stops: readonly number[],
  property: (width: number) => Keyframe,
): Keyframe[] {
  const count = stops.length
  return stops.map((width, index) => ({
    ...property(width),
    offset: (index + 1) / count,
    easing: 'step-end',
  }))
}

// Caret jumps character by character on the same steps, so it stays on the glyph
// being typed. Travel is stepped; opacity is a separate smooth pop-in / fade-out.
function animateCaretTravel(
  caret: HTMLElement,
  width: number,
  item: ScheduleItem,
  easing: string,
): Animation {
  return caret.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${width}px)` }], {
    duration: item.duration,
    delay: item.delay,
    easing,
    fill: 'both',
  })
}

function animateCaretOpacity(caret: HTMLElement, item: ScheduleItem): Animation {
  return caret.animate(
    [
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.06 },
      { opacity: 1, offset: 0.85 },
      { opacity: 0, offset: 1 },
    ],
    { duration: item.duration, delay: item.delay, easing: 'linear', fill: 'both' },
  )
}

function whenAllSettled(animations: readonly Animation[], onDone: () => void): { cancel(): void } {
  let canceled = false
  const fire = () => {
    if (!canceled) onDone()
  }

  /**
   * @justification Fires the completion callback when no animation was started, so a caller hears about it in the
   * same turn ordering either way.
   */
  if (animations.length === 0) queueMicrotask(fire)
  else void Promise.allSettled(animations.map((animation) => animation.finished)).then(fire)

  return { cancel: () => void (canceled = true) }
}

function supportsWaapi(rows: readonly DecodeRevealRow[]): boolean {
  const element = rows[0]?.element
  return !!element && typeof element.animate === 'function'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
