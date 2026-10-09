import type { TextReadSnapshot } from '@singapore-editor/core/document'
import type { InlineReplacementSpec } from '@singapore-editor/core/rendering'
import { Kind } from 'tree-sitter-md'
import { markdownLinkDestination } from './linkDestination'
import { renderMarkdownLinks, type MarkdownLink, type MarkdownLinkOptions } from './linkRender'

type Span = { readonly start: number; readonly end: number }

export function markdownInlineReplacements(
  text: TextReadSnapshot,
  records: Uint32Array,
  options: MarkdownLinkOptions = {},
): readonly InlineReplacementSpec[] {
  const specs: InlineReplacementSpec[] = []
  const links: (Span & { readonly kind: number })[] = []
  const renderedLinks: MarkdownLink[] = []
  const containers = containerSpans(records)
  for (let index = 0; index < records.length; index += 4) {
    const start = records[index]!,
      end = records[index + 1]!
    const kind = records[index + 2]!,
      extra = records[index + 3]!
    if (end <= start) continue
    if (kind === Kind.Link || kind === Kind.Image) links.push({ start, end, kind })
    if (kind === Kind.LinkText) {
      while (links.length && (links.at(-1)!.start > start || links.at(-1)!.end < end)) links.pop()
      const link = links.pop()
      const href =
        link?.kind === Kind.Link
          ? markdownLinkDestination(text, link, { start, end }, records)
          : null
      if (link?.kind === Kind.Image || href !== null) appendLink(specs, text, link, { start, end })
      if (link && href !== null) renderedLinks.push({ span: link, label: { start, end }, href })
    }
    const before = specs.length
    appendMarker(specs, text, { start, end }, kind, extra)
    const owner = markerOwner(containers, { start, end }, kind)
    if (owner) applyRevealRange(specs, before, owner)
  }
  renderMarkdownLinks(specs, text, renderedLinks, options)
  return preserveTableWidths(specs, text, containers)
}

function preserveTableWidths(
  specs: readonly InlineReplacementSpec[],
  source: TextReadSnapshot,
  containers: readonly Container[],
): readonly InlineReplacementSpec[] {
  const tables = containers.filter((container) => container.kind === Kind.Table)
  return specs.map((spec) => {
    if (!tables.some((table) => table.start <= spec.startIndex && table.end >= spec.endIndex))
      return spec
    const width = source.readRange(spec.startIndex, spec.endIndex).length
    const padding = ' '.repeat(Math.max(0, width - spec.text.length))
    if (!padding) return spec
    const render = spec.render
    return {
      ...spec,
      text: spec.text + padding,
      className: 'editor-markdown-text',
      render: paddedRender(render, spec.text.length),
    }
  })
}

function paddedRender(
  render: InlineReplacementSpec['render'],
  textLength: number,
): InlineReplacementSpec['render'] {
  return (container, displayText, displayStart) => {
    const labelLength = Math.max(0, Math.min(displayText.length, textLength - displayStart))
    const text = displayText.slice(0, labelLength)
    const padding = displayText.slice(labelLength)
    const disposable = labelLength > 0 ? render?.(container, text, displayStart) : undefined
    if (!render) container.append(text)
    const spacer = container.ownerDocument.createElement('span')
    spacer.className = 'editor-markdown-padding'
    spacer.textContent = padding
    spacer.ariaHidden = 'true'
    container.append(spacer)
    return disposable
  }
}

function appendMarker(
  specs: InlineReplacementSpec[],
  text: TextReadSnapshot,
  span: Span,
  kind: number,
  extra: number,
): void {
  const group = `${kind}:${span.start}:${span.end}`
  if (
    kind === Kind.Emphasis ||
    kind === Kind.Strong ||
    kind === Kind.Strikethrough ||
    kind === Kind.CodeSpan
  ) {
    const count = delimiterLength(text, span, kind)
    specs.push(replacement(span.start, span.start + count, '', 'marker', group))
    specs.push(replacement(span.end - count, span.end, '', 'marker', group))
    return
  }
  if (kind === Kind.HeadingMark) {
    const end = span.end + leadingSpaces(text, span.end)
    specs.push(replacement(span.start, end, '', `heading-marker-${extra}`, group))
    return
  }
  if (kind === Kind.FenceMark || kind === Kind.CodeInfo) {
    specs.push(replacement(span.start, span.end, '', 'fence-marker', group))
    return
  }
  if (kind === Kind.Task) {
    specs.push(replacement(span.start, span.end, extra ? '☑' : '☐', 'task-marker', group))
    return
  }
  if (kind !== Kind.ListMark && kind !== Kind.QuoteMark) return
  const source = text.readRange(span.start, span.end)
  if (kind === Kind.ListMark && /^[-*+]/.test(source)) {
    specs.push(replacement(span.start, span.end, `•${source.slice(1)}`, 'list-marker', group))
  }
  if (kind === Kind.QuoteMark) {
    specs.push(replacement(span.start, span.end, `│${source.slice(1)}`, 'quote-marker', group))
  }
}

function delimiterLength(text: TextReadSnapshot, span: Span, kind: number): number {
  if (kind === Kind.Strong) return 2
  if (kind === Kind.Emphasis) return 1
  if (kind === Kind.Strikethrough)
    return text.readRange(span.start, span.start + 2) === '~~' ? 2 : 1
  let count = 0
  while (
    span.start + count < span.end &&
    text.readRange(span.start + count, span.start + count + 1) === '`'
  )
    count++
  return count
}

function appendLink(
  specs: InlineReplacementSpec[],
  text: TextReadSnapshot,
  link: Span | undefined,
  label: Span,
): void {
  if (!link) return
  const group = `link:${link.start}:${link.end}`
  appendHiddenLines(specs, text, link.start, label.start, 'link-marker', group, link)
  appendHiddenLines(specs, text, label.end, link.end, 'link-target', group, link)
}

function appendHiddenLines(
  specs: InlineReplacementSpec[],
  text: TextReadSnapshot,
  start: number,
  end: number,
  kind: string,
  group: string,
  owner: Span,
): void {
  const source = text.readRange(start, end)
  let offset = start
  for (const line of source.split(/(\r?\n)/)) {
    if (line && !line.includes('\n'))
      specs.push({
        ...replacement(offset, offset + line.length, '', kind, group),
        revealRange: owner,
      })
    offset += line.length
  }
}

function replacement(
  startIndex: number,
  endIndex: number,
  text: string,
  kind: string,
  groupId: string,
): InlineReplacementSpec {
  return { id: `${kind}:${startIndex}:${endIndex}`, startIndex, endIndex, text, kind, groupId }
}

function leadingSpaces(text: TextReadSnapshot, offset: number): number {
  let count = 0
  while (offset + count < text.length && text.readRange(offset + count, offset + count + 1) === ' ')
    count++
  return count
}

type Container = Span & { readonly kind: number }

function containerSpans(records: Uint32Array): readonly Container[] {
  const containers: Container[] = []
  for (let i = 0; i < records.length; i += 4) {
    const kind = records[i + 2]!
    if (
      kind === Kind.Heading ||
      kind === Kind.Table ||
      kind === Kind.CodeBlock ||
      kind === Kind.BlockQuote ||
      kind === Kind.ListItem
    ) {
      containers.push({ start: records[i]!, end: records[i + 1]!, kind })
    }
  }
  return containers
}

function markerOwner(containers: readonly Container[], span: Span, kind: number): Span | undefined {
  const parent = markerParentKind(kind)
  if (!parent) return undefined
  return containers.findLast(
    (container) =>
      container.kind === parent && container.start <= span.start && container.end >= span.end,
  )
}

function markerParentKind(kind: number): number | undefined {
  if (kind === Kind.HeadingMark) return Kind.Heading
  if (kind === Kind.FenceMark || kind === Kind.CodeInfo) return Kind.CodeBlock
  if (kind === Kind.QuoteMark) return Kind.BlockQuote
  if (kind === Kind.ListMark || kind === Kind.Task) return Kind.ListItem
  return undefined
}

function applyRevealRange(specs: InlineReplacementSpec[], from: number, owner: Span): void {
  for (let i = from; i < specs.length; i++) {
    specs[i] = { ...specs[i]!, revealRange: owner }
  }
}
