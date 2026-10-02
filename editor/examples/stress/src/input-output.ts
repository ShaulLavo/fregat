import type { createInputConsumers } from './inputConsumers.ts'
import {
  minimapMatches,
  replayMinimapLines,
  replayShikiSource,
  replayTreeSitterSource,
} from '../input-worker-proof.mjs'

type ConsumerSession = {
  readonly kind: string
  readonly worker: { readonly terminated: boolean }
  readonly log: readonly unknown[]
  readonly requested: number
  readonly answered: number
  readonly failed: number
  readonly requestedVersion: number | null
  readonly answeredVersion: number | null
  readonly disposed: boolean
}

type MinimapProof = {
  readonly terminated: boolean
  readonly minimap: boolean
  readonly minimapLog: readonly unknown[]
  readonly sourceUpdates: number
  readonly latestRender: number
  readonly acceptedRender: number
  readonly renderAfterSource: number
}

// Each live consumer session's receipt, replayed after the measured interval: the source its
// worker last received equals the current text, and that request was answered.
function consumerSessions(text: string) {
  const sessions: Iterable<ConsumerSession> = globalThis.__inputWorkerSources?.values() ?? []
  return [...sessions]
    .filter(
      (session) =>
        !session.disposed &&
        !session.worker.terminated &&
        (session.kind === 'shiki' || session.kind === 'treeSitter'),
    )
    .map((session) => {
      const source =
        session.kind === 'shiki'
          ? replayShikiSource(session.log)
          : replayTreeSitterSource(session.log)
      return {
        kind: session.kind,
        current: source === text,
        answered: session.requested > 0 && session.answered === session.requested,
        failed: session.failed === session.requested && session.requested > 0,
        requestedVersion: session.requestedVersion,
        answeredVersion: session.answeredVersion,
      }
    })
}

// Each live minimap worker, one per view: its replayed line summaries match the current text, and
// its accepted render was requested after its last source update.
function minimapReceipts(text: string) {
  const workers = (globalThis.__inputWorkerProof ?? []) as readonly MinimapProof[]
  return workers
    .filter((worker) => worker.minimap && !worker.terminated)
    .map((worker) => ({
      current: minimapMatches(replayMinimapLines(worker.minimapLog), text),
      renderedAfterSource:
        worker.renderAfterSource === worker.sourceUpdates &&
        worker.latestRender > 0 &&
        worker.acceptedRender === worker.latestRender,
    }))
}

function tokenHighlights() {
  return [...CSS.highlights].filter(([name]) => name.startsWith('editor-shared-token-'))
}

function viewTokenRanges(index: number): number {
  const host = document.getElementById(`view-${index}`)
  if (!host) return 0
  let count = 0
  for (const [, ranges] of tokenHighlights())
    for (const range of ranges) if (host.contains(range.startContainer)) count++
  return count
}

// Probe-only negative: the last visible view loses its token ranges while the others keep theirs.
function dropLastVisibleViewRanges(viewCount: number) {
  const visible = Array.from({ length: viewCount }, (_, index) =>
    document.getElementById(`view-${index}`),
  ).filter((host): host is HTMLElement => Boolean(host?.checkVisibility()))
  const host = visible.at(-1)
  if (!host || visible.length < 2) return
  for (const [, ranges] of tokenHighlights())
    for (const range of [...ranges]) if (host.contains(range.startContainer)) ranges.delete(range)
}

function linesLongerThan(text: string, limit: number): number {
  let count = 0
  for (const line of text.split('\n')) if (line.replace(/\r$/, '').length > limit) count++
  return count
}

// The colour each `::highlight(name)` rule paints, read from the page's own stylesheets.
function highlightColors(): Map<string, string> {
  const colors = new Map<string, string>()
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue
      const name = /::highlight\(([^)]+)\)/.exec(rule.selectorText)?.[1]
      if (name && rule.style.color) colors.set(name, rule.style.color)
    }
  }
  return colors
}

export function plainChunkCoverage(index: number) {
  const host = document.getElementById(`view-${index}`)
  if (!host) return { chunks: 0, covered: 0 }
  const painted = [...CSS.highlights]
    .filter(([name]) => name.startsWith('editor-shared-token-'))
    .flatMap(([, ranges]) => [...ranges])
    .filter((range) => host.contains(range.startContainer) && host.contains(range.endContainer))
    .map((range) => {
      const comparable = document.createRange()
      comparable.setStart(range.startContainer, range.startOffset)
      comparable.setEnd(range.endContainer, range.endOffset)
      return comparable
    })
  const chunks = [...host.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')].flatMap(
    (row) => {
      const mounted = [...row.querySelectorAll<HTMLElement>('[data-editor-virtual-chunk-start]')]
      return mounted.length ? mounted : [row]
    },
  )
  return {
    chunks: chunks.length,
    covered: chunks.filter((chunk) => chunkCovered(chunk, painted)).length,
  }
}

function chunkCovered(chunk: HTMLElement, painted: readonly Range[]) {
  const text = document.createTreeWalker(chunk, NodeFilter.SHOW_TEXT)
  let nonempty = false
  for (let node = text.nextNode(); node; node = text.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (!length) continue
    nonempty = true
    if (
      !painted.some(
        (range) => range.comparePoint(node, 0) === 0 && range.comparePoint(node, length) === 0,
      )
    )
      return false
  }
  return nonempty
}

declare global {
  var __inputWorkerSources: Map<string, ConsumerSession> | undefined
  var __inputReadinessNegative: string | null | undefined
}

export function readInputOutput(
  readiness: Awaited<ReturnType<ReturnType<typeof createInputConsumers>['settle']>>,
  text: string,
) {
  if (globalThis.__inputReadinessNegative === 'drop-view-ranges')
    dropLastVisibleViewRanges(readiness.views.length)
  const colors = highlightColors()
  const highlights = [...CSS.highlights].map(([name, ranges]) => ({
    name,
    ranges: ranges.size,
    color: colors.get(name) ?? null,
  }))
  const lineLimit = readiness.shiki?.maxTokenizationLineLength ?? null
  const row = document.querySelector('#view-0 [data-editor-virtual-row]')
  return {
    ...readiness,
    views: readiness.views.map((view, index) => ({
      ...view,
      tokenRanges: viewTokenRanges(index),
      plainCoverage: readiness.shiki?.untokenizedLines ? plainChunkCoverage(index) : null,
    })),
    sessions: consumerSessions(text),
    minimaps: minimapReceipts(text),
    highlights,
    lineCount: text.split('\n').length,
    overLimitLines: lineLimit === null ? null : linesLongerThan(text, lineLimit),
    rowColor: row ? getComputedStyle(row).color : null,
  }
}
