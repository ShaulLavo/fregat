import { ultrathinkMatches } from '@/features/chat/utils/effort-sparkle'

/** One highlight per hue; letter i takes hue i mod this, styled in globals.css. */
const HUES = 4
const WORD_LENGTH = 'ultrathink'.length

/**
 * The CSS Highlight registry is document-wide, so each composer's ranges are kept
 * here and the registry holds their union.
 */
const rangesByRoot = new Map<HTMLElement, Range[][]>()

export function paintUltrathink(root: HTMLElement, enabled: boolean) {
  if (!highlightsSupported()) return

  rangesByRoot.set(root, enabled ? ultrathinkRanges(root) : [])
  syncHighlights()
}

export function clearUltrathink(root: HTMLElement) {
  if (!highlightsSupported()) return

  rangesByRoot.delete(root)
  syncHighlights()
}

function highlightsSupported() {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

function syncHighlights() {
  for (let hue = 0; hue < HUES; hue += 1) {
    const ranges = [...rangesByRoot.values()].flatMap((byHue) => byHue[hue] ?? [])
    const name = `ultrathink-${hue}`
    if (ranges.length === 0) {
      CSS.highlights.delete(name)
      continue
    }

    CSS.highlights.set(name, new Highlight(...ranges))
  }
}

function ultrathinkRanges(root: HTMLElement) {
  const byHue: Range[][] = Array.from({ length: HUES }, () => [])
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const start of ultrathinkMatches(node.textContent ?? '')) {
      addLetterRanges(byHue, node, start)
    }
  }

  return byHue
}

function addLetterRanges(byHue: Range[][], node: Node, start: number) {
  for (let letter = 0; letter < WORD_LENGTH; letter += 1) {
    const range = document.createRange()
    range.setStart(node, start + letter)
    range.setEnd(node, start + letter + 1)
    byHue[letter % HUES]?.push(range)
  }
}
