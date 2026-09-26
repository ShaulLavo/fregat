import { ultrathinkMatches } from '@/features/chat/utils/effort-tier'

/** Letter i takes hue i mod this; both families are styled in globals.css. */
const HUES = 7
const WORD_LENGTH = 'ultrathink'.length
/** The glint walks from two letters before the word to two after, then rests. */
const GLINT_PATH = WORD_LENGTH + 4
const GLINT_REST = 22
const GLINT_STEP_MS = 70

/**
 * The CSS Highlight registry is document-wide, so each composer's letter ranges
 * are kept here and the registry holds their union.
 */
const wordsByRoot = new Map<HTMLElement, Range[][]>()
let step = 0
let timer: ReturnType<typeof setTimeout> | undefined

export function paintUltrathink(root: HTMLElement, enabled: boolean) {
  if (!highlightsSupported()) return

  wordsByRoot.set(root, enabled ? ultrathinkWords(root) : [])
  syncHighlights()
  scheduleGlint()
}

export function clearUltrathink(root: HTMLElement) {
  if (!highlightsSupported()) return

  wordsByRoot.delete(root)
  syncHighlights()
  scheduleGlint()
}

function highlightsSupported() {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

function syncHighlights() {
  const base: Range[][] = Array.from({ length: HUES }, () => [])
  const glint: Range[][] = Array.from({ length: HUES }, () => [])
  const centre = step < GLINT_PATH ? step - 2 : Number.NaN
  for (const words of wordsByRoot.values()) {
    for (const letters of words) {
      letters.forEach((range, index) => {
        const lit = Math.abs(index - centre) <= 1
        ;(lit ? glint : base)[index % HUES]?.push(range)
      })
    }
  }
  for (let hue = 0; hue < HUES; hue += 1) {
    setHighlight(`ultrathink-${hue}`, base[hue] ?? [])
    setHighlight(`ultrathink-glint-${hue}`, glint[hue] ?? [])
  }
}

function setHighlight(name: string, ranges: Range[]) {
  if (ranges.length === 0) {
    CSS.highlights.delete(name)
    return
  }

  CSS.highlights.set(name, new Highlight(...ranges))
}

/** One timer for every composer, alive only while a word is painted and motion is allowed. */
function scheduleGlint() {
  const painted = [...wordsByRoot.values()].some((words) => words.length > 0)
  if (!painted || prefersReducedMotion()) {
    clearTimeout(timer)
    timer = undefined
    step = 0
    return
  }
  timer ??= setTimeout(advanceGlint, GLINT_STEP_MS)
}

function advanceGlint() {
  timer = undefined
  step = (step + 1) % (GLINT_PATH + GLINT_REST)
  // The first rest step repaints once to clear the glint; the rest of the rest is free.
  if (step <= GLINT_PATH) syncHighlights()
  scheduleGlint()
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function ultrathinkWords(root: HTMLElement) {
  const words: Range[][] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const start of ultrathinkMatches(node.textContent ?? '')) {
      words.push(letterRanges(node, start))
    }
  }

  return words
}

function letterRanges(node: Node, start: number) {
  return Array.from({ length: WORD_LENGTH }, (_, letter) => {
    const range = document.createRange()
    range.setStart(node, start + letter)
    range.setEnd(node, start + letter + 1)
    return range
  })
}
