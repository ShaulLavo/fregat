import type { EditorViewContributionContext } from '@singapore-editor/core/extensions'
import type { InlineReplacementSpec } from '@singapore-editor/core/rendering'
import type { TextReadSnapshot } from '@singapore-editor/core/document'
import type { MarkdownSpan } from './linkDestination'

export type MarkdownLinkOptions = {
  readonly registerKeymapNode?: EditorViewContributionContext['registerKeymapNode']
  readonly openLink?: (href: string) => void
}

export type MarkdownLink = {
  readonly span: MarkdownSpan
  readonly label: MarkdownSpan
  readonly href: string
}

export function renderMarkdownLinks(
  specs: InlineReplacementSpec[],
  source: TextReadSnapshot,
  links: readonly MarkdownLink[],
  options: MarkdownLinkOptions,
): void {
  if (!links.length) return
  const ordered = sourceOrder(specs, (spec) => spec.startIndex)
  const consumed = new Set<InlineReplacementSpec>()
  const rendered = new Map<MarkdownLink, InlineReplacementSpec[]>()
  let cursor = 0
  let parent: MarkdownLink | undefined
  for (const link of sourceOrder(links, (link) => link.span.start)) {
    if (parent && contains(parent.label, link.span)) continue
    parent = link
    const runs: InlineReplacementSpec[] = []
    rendered.set(link, runs)
    const firstRow = source.lineAt(link.label.start)
    const lastRow = source.lineAt(link.label.end)
    for (let row = firstRow; row <= lastRow; row++) {
      const line = source.lineRange(row)
      const start = Math.max(link.label.start, line.start)
      const end = Math.min(link.label.end, line.end)
      if (end <= start) continue
      const inner: InlineReplacementSpec[] = []
      while (cursor < ordered.length && ordered[cursor]!.startIndex < end) {
        const spec = ordered[cursor++]!
        if (spec.startIndex < start || spec.endIndex > end) continue
        inner.push(spec)
        consumed.add(spec)
      }
      runs.push(linkRun(source, link, { start, end }, inner, options))
    }
  }
  let retained = 0
  for (const spec of specs) {
    if (!consumed.has(spec)) specs[retained++] = spec
  }
  specs.length = retained
  for (const link of links) {
    for (const run of rendered.get(link) ?? []) specs.push(run)
  }
}

function linkRun(
  source: TextReadSnapshot,
  link: MarkdownLink,
  label: MarkdownSpan,
  inner: readonly InlineReplacementSpec[],
  options: MarkdownLinkOptions,
): InlineReplacementSpec {
  const sourceText = source.readRange(label.start, label.end)
  const chunks: string[] = []
  let offset = 0
  for (const spec of inner) {
    chunks.push(sourceText.slice(offset, spec.startIndex - label.start), spec.text)
    offset = spec.endIndex - label.start
  }
  chunks.push(sourceText.slice(offset))
  return {
    id: `link-label:${label.start}:${label.end}`,
    startIndex: label.start,
    endIndex: label.end,
    text: chunks.join(''),
    kind: 'link',
    wrap: 'text',
    className: 'editor-markdown-text',
    groupId: `link:${link.span.start}:${link.span.end}`,
    revealRange: link.span,
    render: linkMount(link, options),
  }
}

// Parser offsets are unsigned 32-bit integers. Stable radix passes keep ordering linear
// even when nested opening and closing markers arrive out of source order.
function sourceOrder<T>(values: readonly T[], offset: (value: T) => number): readonly T[] {
  const keys = Uint32Array.from(values, offset)
  let sorted = true
  for (let index = 1; index < keys.length; index++) {
    if (keys[index - 1]! > keys[index]!) sorted = false
  }
  if (sorted) return values
  let order = Uint32Array.from({ length: values.length }, (_, index) => index)
  let next = new Uint32Array(values.length)
  const counts = new Uint32Array(256)
  for (let shift = 0; shift < 32; shift += 8) {
    counts.fill(0)
    for (const index of order) counts[(keys[index]! >>> shift) & 255]!++
    let start = 0
    for (let bucket = 0; bucket < counts.length; bucket++) {
      const count = counts[bucket]!
      counts[bucket] = start
      start += count
    }
    for (const index of order) next[counts[(keys[index]! >>> shift) & 255]!++] = index
    ;[order, next] = [next, order]
  }
  return Array.from(order, (index) => values[index]!)
}

function linkMount(
  link: MarkdownLink,
  options: MarkdownLinkOptions,
): InlineReplacementSpec['render'] {
  return (container, displayText) => {
    const anchor = container.ownerDocument.createElement('a')
    anchor.href = link.href
    anchor.textContent = displayText
    anchor.title = link.href
    anchor.className = 'editor-markdown-link'
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.addEventListener('pointerdown', (event) => event.stopPropagation())
    anchor.addEventListener('mousedown', (event) => event.stopPropagation())
    anchor.addEventListener('click', (event) => {
      event.stopPropagation()
      if (!options.openLink) return
      event.preventDefault()
      options.openLink(link.href)
    })
    container.append(anchor)
    return options.registerKeymapNode?.({
      element: anchor,
      context: 'EditorWidget MarkdownLink',
      commands: {
        'markdown.openLink': () => {
          anchor.click()
          return true
        },
      },
    })
  }
}

function contains(outer: MarkdownSpan, inner: MarkdownSpan): boolean {
  return outer.start <= inner.start && outer.end >= inner.end
}
