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
  for (const link of links) {
    if (links.some((other) => other !== link && contains(other.label, link.span))) continue
    const firstRow = source.lineAt(link.label.start)
    const lastRow = source.lineAt(link.label.end)
    for (let row = firstRow; row <= lastRow; row++) {
      const line = source.lineRange(row)
      const start = Math.max(link.label.start, line.start)
      const end = Math.min(link.label.end, line.end)
      appendLinkRun(specs, source, link, { start, end }, options)
    }
  }
}

function appendLinkRun(
  specs: InlineReplacementSpec[],
  source: TextReadSnapshot,
  link: MarkdownLink,
  label: MarkdownSpan,
  options: MarkdownLinkOptions,
): void {
  if (label.end <= label.start) return
  const inner = specs.filter((spec) =>
    contains(label, { start: spec.startIndex, end: spec.endIndex }),
  )
  let text = source.readRange(label.start, label.end)
  for (const spec of inner.sort((a, b) => b.startIndex - a.startIndex)) {
    text =
      text.slice(0, spec.startIndex - label.start) +
      spec.text +
      text.slice(spec.endIndex - label.start)
  }
  const replaced = new Set(inner)
  const retained = specs.filter((spec) => !replaced.has(spec))
  specs.splice(0, specs.length, ...retained)
  specs.push({
    id: `link-label:${label.start}:${label.end}`,
    startIndex: label.start,
    endIndex: label.end,
    text,
    kind: 'link',
    wrap: 'text',
    className: 'editor-markdown-text',
    groupId: `link:${link.span.start}:${link.span.end}`,
    revealRange: link.span,
    render: linkMount(link, options),
  })
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
