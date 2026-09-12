import { fromMarkdown } from 'mdast-util-from-markdown'

const DIRECTIVE = /:codex-file-citation\{([^{}\r\n]*)\}/gu
const ATTRIBUTE = /([\w-]+)\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)')/gu
const LITERAL_NODES = new Set([
  'code',
  'inlineCode',
  'html',
  'link',
  'linkReference',
  'image',
  'imageReference',
  'definition',
])

type MarkdownNode = {
  type: string
  position?: { start: { offset?: number }; end: { offset?: number } }
  children?: readonly MarkdownNode[]
}
type LiteralRange = { start: number; end: number }

export function codexFileCitationsMarkdown(markdown: string) {
  if (!markdown.includes(':codex-file-citation{')) return markdown
  const ranges: LiteralRange[] = []
  collectLiteralRanges(fromMarkdown(markdown), ranges)
  let rangeIndex = 0
  return markdown.replace(DIRECTIVE, (original: string, attributes: string, offset: number) => {
    while (ranges[rangeIndex] && ranges[rangeIndex]!.end <= offset) rangeIndex += 1
    const range = ranges[rangeIndex]
    if (range && range.start < offset + original.length) return original
    if (isEscaped(markdown, offset)) return original
    return fileCitation(original, attributes)
  })
}

function collectLiteralRanges(node: MarkdownNode, ranges: LiteralRange[]) {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (LITERAL_NODES.has(node.type) && start !== undefined && end !== undefined) {
    ranges.push({ start, end })
    return
  }
  for (const child of node.children ?? []) collectLiteralRanges(child, ranges)
}

function isEscaped(markdown: string, offset: number) {
  let escapes = 0
  for (let index = offset - 1; index >= 0 && markdown[index] === '\\'; index -= 1) escapes += 1
  return escapes % 2 === 1
}

function fileCitation(original: string, attributes: string) {
  const values = new Map<string, string>()
  let end = 0
  for (const match of attributes.matchAll(ATTRIBUTE)) {
    if (attributes.slice(end, match.index).trim() || !match[1] || values.has(match[1]))
      return original
    values.set(match[1], match[2] ?? match[3] ?? '')
    end = match.index + match[0].length
  }
  if (attributes.slice(end).trim()) return original
  const path = values.get('path')?.trim()
  if (!path || path.includes('\0') || /[\r\n]/u.test(path) || /^[a-z][a-z\d+.-]*:/iu.test(path))
    return original
  const basename = path.replaceAll('\\', '/').replace(/\/+$/u, '').split('/').at(-1) || path
  const label = basename.replaceAll('\\', '\\\\').replace(/[[\]*_`<&]/gu, '\\$&')
  const line = Number(values.get('line_range_start'))
  const anchor = Number.isSafeInteger(line) && line > 0 ? `#L${line}` : ''
  const destination = path.split('/').map(encodeURIComponent).join('/')
  return `[${label}](${destination}${anchor})`
}
