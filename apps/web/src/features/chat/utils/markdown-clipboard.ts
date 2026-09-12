/**
 * Turns a DOM selection inside rendered chat markdown back into markdown source
 * so highlight-and-copy keeps links, emphasis, lists, fences and tables instead
 * of flattening to text. `text/plain` carries the markdown; `text/html` carries
 * a sanitized copy of the rendered fragment for rich-paste targets.
 */

export type MarkdownClipboardPayload = {
  readonly html: string
  readonly text: string
}

const SKIPPED_TAGS = new Set(['BUTTON', 'INPUT', 'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE'])
const SKIPPED_CLASS_NAMES = ['select-none', 'sr-only']
const SANITIZED_HTML_SELECTOR = [
  'button',
  'input',
  'script',
  'style',
  'svg',
  '[aria-hidden="true"]',
  ...SKIPPED_CLASS_NAMES.map((className) => `.${className}`),
].join(', ')

export function chatMarkdownClipboardPayload(
  selection: Selection,
): MarkdownClipboardPayload | null {
  const texts: string[] = []
  const htmls: string[] = []

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index)
    if (range.collapsed) continue

    const container = document.createElement('div')
    container.append(range.cloneContents())
    const text = serializeRenderedMarkdownFragment(container)
    if (!text) continue

    texts.push(text)
    htmls.push(sanitizedHtml(container))
  }

  if (texts.length === 0) return null

  return { html: htmls.join(''), text: texts.join('\n\n') }
}

export function serializeRenderedMarkdownFragment(container: Node) {
  return tidyMarkdown(serializeChildren(container))
}

function sanitizedHtml(container: Element) {
  for (const imageButton of container.querySelectorAll('[data-markdown-image]')) {
    imageButton.replaceWith(...imageButton.childNodes)
  }
  for (const node of container.querySelectorAll(SANITIZED_HTML_SELECTOR)) {
    node.remove()
  }

  return `<meta charset="utf-8">${container.innerHTML}`
}

function serializeChildren(node: Node) {
  let out = ''
  for (const child of node.childNodes) {
    out += serializeNode(child)
  }

  return out
}

function serializeNode(node: Node): string {
  if (node.nodeType === 3) return serializeText(node.textContent ?? '')
  if (node.nodeType !== 1) return ''

  const element = node as Element
  const copyOverride = element.getAttribute('data-markdown-copy')
  if (copyOverride !== null) return copyOverride
  if (element.hasAttribute('data-markdown-image')) return serializeChildren(element)
  if (isSkipped(element)) return ''

  const headingLevel = /^H([1-6])$/u.exec(element.tagName)?.[1]
  if (headingLevel)
    return `${'#'.repeat(Number(headingLevel))} ${serializeChildren(element).trim()}\n\n`

  return serializeElement(element)
}

function serializeText(text: string) {
  // Inter-block formatting whitespace from the renderer collapses to a newline;
  // real inline whitespace passes through untouched.
  if (text.includes('\n') && text.trim().length === 0) return '\n'

  return text
}

function serializeElement(element: Element): string {
  switch (element.tagName) {
    case 'BR':
      return '\n'
    case 'HR':
      return '---\n\n'
    case 'P':
      return `${serializeChildren(element).trim()}\n\n`
    case 'PRE':
      return serializeCodeBlock(element)
    case 'CODE':
      return wrapInlineCode(element.textContent ?? '')
    case 'STRONG':
    case 'B':
      return wrapInlineMarker(serializeChildren(element), '**')
    case 'EM':
    case 'I':
      return wrapInlineMarker(serializeChildren(element), '*')
    case 'DEL':
    case 'S':
      return wrapInlineMarker(serializeChildren(element), '~~')
    case 'A':
      return serializeAnchor(element)
    case 'IMG':
      return serializeImage(element)
    case 'UL':
      return serializeList(element, false)
    case 'OL':
      return serializeList(element, true)
    case 'BLOCKQUOTE':
      return serializeBlockquote(element)
    case 'TABLE':
      return serializeTable(element)
    default:
      return serializeContainer(element)
  }
}

function serializeContainer(element: Element) {
  const content = serializeChildren(element)
  if (!BLOCK_CONTAINER_TAGS.has(element.tagName)) return content
  if (!content) return content
  if (content.endsWith('\n')) return content

  return `${content}\n`
}

const BLOCK_CONTAINER_TAGS = new Set(['ARTICLE', 'DIV', 'SECTION'])

function isSkipped(element: Element) {
  if (SKIPPED_TAGS.has(element.tagName)) return true
  if (element.getAttribute('aria-hidden') === 'true') return true

  return SKIPPED_CLASS_NAMES.some((className) => element.classList.contains(className))
}

/** Hoists surrounding whitespace outside the markers: "` bold `" → " **bold** ". */
function wrapInlineMarker(content: string, marker: string) {
  const match = /^(\s*)([\s\S]*?)(\s*)$/u.exec(content)
  const core = match?.[2] ?? ''
  if (!core) return content

  return `${match?.[1] ?? ''}${marker}${core}${marker}${match?.[3] ?? ''}`
}

function wrapInlineCode(code: string) {
  const longestRun = longestBacktickRun(code, /`+/gu)
  const fence = '`'.repeat(Math.max(1, longestRun === 0 ? 1 : longestRun + 1))
  const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : ''

  return `${fence}${pad}${code}${pad}${fence}`
}

function longestBacktickRun(code: string, pattern: RegExp) {
  let longest = 0
  for (const run of code.match(pattern) ?? []) {
    longest = Math.max(longest, run.length)
  }

  return longest
}

function serializeCodeBlock(pre: Element) {
  const code = (pre.textContent ?? '').replace(/\n$/u, '')
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(code, /`{3,}/gu) + 1))

  return `${fence}${codeBlockLanguage(pre) ?? ''}\n${code}\n${fence}\n\n`
}

function codeBlockLanguage(pre: Element) {
  const declared =
    pre.closest('[data-language]')?.getAttribute('data-language') ??
    /(?:^|\s)language-(\S+)/u.exec(pre.querySelector('code')?.className ?? '')?.[1] ??
    null
  if (!declared) return null
  if (declared === 'text') return null

  return declared
}

function serializeAnchor(anchor: Element) {
  const content = serializeChildren(anchor)
  const href = anchor.getAttribute('href') ?? ''
  if (!/^https?:\/\//iu.test(href)) return content

  const label = content.trim()
  if (!label) return ''
  if (label === href) return href

  return `[${label}](${href})`
}

function serializeImage(image: Element) {
  const alt = image.getAttribute('alt') ?? ''
  const src = image.getAttribute('src') ?? ''
  if (!src) return ''

  return `![${alt}](${src})`
}

function serializeList(list: Element, ordered: boolean) {
  const start = Number.parseInt(list.getAttribute('start') ?? '1', 10) || 1
  const items = [...list.children].filter((child) => child.tagName === 'LI')
  if (items.length === 0) return ''

  const lines = items.map((item, index) => serializeListItem(item, ordered, start + index))

  return `${lines.join('\n')}\n\n`
}

function serializeListItem(item: Element, ordered: boolean, index: number) {
  const checkbox = item.querySelector('input[type="checkbox"]')
  const task = checkbox ? `[${(checkbox as HTMLInputElement).checked ? 'x' : ' '}] ` : ''
  const marker = ordered ? `${index}. ${task}` : `- ${task}`
  const content = listItemContent(item)
  const indent = ' '.repeat(marker.length)
  const [first = '', ...rest] = content.split('\n')

  return [`${marker}${first}`, ...rest.map((line) => (line ? `${indent}${line}` : line))].join('\n')
}

function listItemContent(item: Element) {
  const content = serializeChildren(item)
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  // Tight items (no paragraph children) keep nested lists on adjacent lines.
  if (item.querySelector(':scope > p')) return content

  return content.replace(/\n{2,}/gu, '\n')
}

function serializeBlockquote(quote: Element) {
  const content = serializeChildren(quote)
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  if (!content) return ''

  const quoted = content
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')

  return `${quoted}\n\n`
}

function serializeTable(table: Element) {
  const rows = [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')]
  const lines: string[] = []
  let separated = false

  for (const row of rows) {
    const cells = [...row.children].filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD')
    if (cells.length === 0) continue

    lines.push(`| ${cells.map((cell) => serializeTableCell(cell)).join(' | ')} |`)
    if (separated) continue

    lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
    separated = true
  }

  if (lines.length === 0) return ''

  return `${lines.join('\n')}\n\n`
}

function serializeTableCell(cell: Element) {
  return serializeChildren(cell).replace(/\n+/gu, ' ').trim().replaceAll('|', '\\|')
}

/** Collapses serializer spacing artifacts without touching fenced code content. */
function tidyMarkdown(markdown: string) {
  return markdown
    .split(/(```[\s\S]*?(?:```|$))/u)
    .map((part, index) => (index % 2 === 1 ? part : tidyProse(part)))
    .join('')
    .trim()
}

function tidyProse(part: string) {
  return part.replace(/[ \t]+(?=\n)/gu, '').replace(/\n{3,}/gu, '\n\n')
}
