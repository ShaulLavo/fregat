import { applyEditorTheme, type EditorTheme } from '@singapore-editor/core/rendering'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'

import { paintCodeTokens, type TooltipCodeBlock, type TooltipCodeTokenizer } from './codeTokens'

type MarkdownNode = {
  readonly type: string
  readonly value?: unknown
  readonly children?: readonly MarkdownNode[]
  readonly lang?: unknown
  readonly url?: unknown
  readonly ordered?: unknown
  readonly checked?: unknown
  readonly depth?: unknown
  readonly align?: readonly (string | null | undefined)[]
}

export type TooltipMarkdownRenderOptions = {
  readonly codeBackground?: boolean
  readonly classNamespace?: string
  readonly codeTokenizer?: TooltipCodeTokenizer | null
}

type TooltipMarkdownRenderContext = {
  readonly classNamespace: string
  readonly codeTokenizer: TooltipCodeTokenizer | null
  readonly inlineCodeBackgroundVariable: string
  readonly codeBlockBackgroundVariable: string
}

// Built on first use, not at import: a host that never shows a markdown hover
// should not pay for two unified pipelines while it boots.
const createMarkdownParser = () => unified().use(remarkParse).use(remarkGfm)
const createMarkdownStringifier = () =>
  unified().use(remarkParse).use(remarkGfm).use(remarkStringify)

let parseProcessor: ReturnType<typeof createMarkdownParser> | null = null
let stringifyProcessor: ReturnType<typeof createMarkdownStringifier> | null = null

function markdownParser() {
  parseProcessor ??= createMarkdownParser()
  return parseProcessor
}

function markdownStringifier() {
  stringifyProcessor ??= createMarkdownStringifier()
  return stringifyProcessor
}

export function normalizeTooltipMarkdown(markdown: string): string {
  return String(markdownStringifier().processSync(markdown))
}

/** The fenced blocks a render of this Markdown would ask tokens for. */
export function tooltipCodeBlocks(markdown: string): readonly TooltipCodeBlock[] {
  const blocks: TooltipCodeBlock[] = []
  collectCodeBlocks(markdownParser().parse(markdown) as MarkdownNode, blocks)
  return blocks
}

function collectCodeBlocks(node: MarkdownNode, blocks: TooltipCodeBlock[]): void {
  const languageId = codeLanguage(node.lang)
  if (node.type === 'code' && languageId) blocks.push({ text: stringValue(node.value), languageId })
  for (const child of node.children ?? []) collectCodeBlocks(child, blocks)
}

function codeLanguage(lang: unknown): string {
  return typeof lang === 'string' ? lang.toLowerCase() : ''
}

export function renderTooltipMarkdown(
  document: Document,
  markdown: string,
  theme?: EditorTheme | null,
  options: TooltipMarkdownRenderOptions = {},
): HTMLElement {
  const context = tooltipMarkdownRenderContext(options)
  const root = document.createElement('div')
  root.className = tooltipClassName(context.classNamespace, 'markdown')
  applyEditorTheme(root, theme)
  applyCodeBackgroundVariables(root, options, context)
  applyStyles(root, {
    display: 'block',
  })

  const tree = markdownParser().parse(markdown) as MarkdownNode
  appendChildren(root, document, tree.children ?? [], context)
  return root
}

function tooltipMarkdownRenderContext(
  options: TooltipMarkdownRenderOptions,
): TooltipMarkdownRenderContext {
  const classNamespace = options.classNamespace ?? 'plugin'
  return {
    classNamespace,
    codeTokenizer: options.codeTokenizer ?? null,
    inlineCodeBackgroundVariable: `--editor-${classNamespace}-hover-inline-code-background`,
    codeBlockBackgroundVariable: `--editor-${classNamespace}-hover-code-block-background`,
  }
}

function tooltipClassName(classNamespace: string, part: string): string {
  return `editor-${classNamespace}-hover-${part}`
}

function appendChildren(
  parent: Node,
  document: Document,
  children: readonly MarkdownNode[],
  context: TooltipMarkdownRenderContext,
): void {
  for (const child of children) appendNode(parent, document, child, context)
}

function appendNode(
  parent: Node,
  document: Document,
  node: MarkdownNode,
  context: TooltipMarkdownRenderContext,
): void {
  const rendered = renderNode(document, node, context)
  if (rendered) {
    parent.appendChild(rendered)
    return
  }

  appendChildren(parent, document, node.children ?? [], context)
}

function renderNode(
  document: Document,
  node: MarkdownNode,
  context: TooltipMarkdownRenderContext,
): Node | null {
  if (node.type === 'text') return document.createTextNode(stringValue(node.value))
  if (node.type === 'paragraph') return parentElement(document, 'p', node, context)
  if (node.type === 'inlineCode')
    return inlineCodeElement(document, stringValue(node.value), context)
  if (node.type === 'code')
    return codeBlockElement(document, stringValue(node.value), node.lang, context)
  if (node.type === 'break') return document.createElement('br')
  if (node.type === 'emphasis') return parentElement(document, 'em', node, context)
  if (node.type === 'strong') return parentElement(document, 'strong', node, context)
  if (node.type === 'delete') return parentElement(document, 'del', node, context)
  if (node.type === 'link') return linkElement(document, node, context)
  if (node.type === 'list') return listElement(document, node, context)
  if (node.type === 'listItem') return listItemElement(document, node, context)
  if (node.type === 'table') return tableElement(document, node, context)
  if (node.type === 'heading') return headingElement(document, node, context)
  if (node.type === 'blockquote') return blockquoteElement(document, node, context)
  if (node.type === 'thematicBreak') return document.createElement('hr')
  if (node.type === 'html') return document.createTextNode(stringValue(node.value))
  return fallbackNode(document, node, context)
}

function parentElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  node: MarkdownNode,
  context: TooltipMarkdownRenderContext,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  appendChildren(element, document, node.children ?? [], context)
  return element
}

function inlineCodeElement(
  document: Document,
  value: string,
  context: TooltipMarkdownRenderContext,
): HTMLElement {
  const element = document.createElement('code')
  element.textContent = value
  applyStyles(element, {
    padding: '1px 4px',
    borderRadius: '4px',
    background: `var(${context.inlineCodeBackgroundVariable}, transparent)`,
    color: 'var(--editor-foreground, #f4f4f5)',
    font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  })
  return element
}

function codeBlockElement(
  document: Document,
  value: string,
  lang: unknown,
  context: TooltipMarkdownRenderContext,
): HTMLElement {
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  const language = codeLanguage(lang)
  renderCodeContent(document, code, value, language, context)
  if (language) code.dataset.language = language

  applyStyles(pre, {
    margin: '0',
    padding: '0',
    borderRadius: '5px',
    background: `var(${context.codeBlockBackgroundVariable}, transparent)`,
    color: 'var(--editor-foreground, #f4f4f5)',
    boxSizing: 'border-box',
    maxWidth: '100%',
    overflow: 'hidden',
  })
  applyStyles(code, {
    display: 'block',
    font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  })

  pre.append(code)
  return pre
}

function applyCodeBackgroundVariables(
  element: HTMLElement,
  options: TooltipMarkdownRenderOptions,
  context: TooltipMarkdownRenderContext,
): void {
  if (!options.codeBackground) return

  element.style.setProperty(
    context.inlineCodeBackgroundVariable,
    'color-mix(in srgb, var(--editor-foreground, #a1a1aa) 16%, transparent)',
  )
  element.style.setProperty(
    context.codeBlockBackgroundVariable,
    'color-mix(in srgb, var(--editor-background, #09090b) 88%, var(--editor-foreground, #f4f4f5) 12%)',
  )
}

function renderCodeContent(
  document: Document,
  code: HTMLElement,
  value: string,
  language: string,
  context: TooltipMarkdownRenderContext,
): void {
  code.textContent = value
  const tokenizer = context.codeTokenizer
  if (!tokenizer || !language) return

  const cached = tokenizer.cached(value, language)
  if (cached) return paintCodeTokens(document, code, value, cached)

  // Reached only when the hold ran out. Colour only, so the block keeps its size.
  void tokenizer
    .tokenize(value, language)
    .then((tokens) => paintCodeTokens(document, code, value, tokens))
}

function linkElement(
  document: Document,
  node: MarkdownNode,
  context: TooltipMarkdownRenderContext,
): HTMLElement {
  const href = safeLinkHref(node.url)
  if (!href) return parentElement(document, 'span', node, context)

  const element = document.createElement('a')
  element.href = href
  element.target = '_blank'
  element.rel = 'noreferrer'
  applyStyles(element, {
    color: 'var(--editor-caret-color, #93c5fd)',
    textDecoration: 'underline',
  })
  appendChildren(element, document, node.children ?? [], context)
  return element
}

function listElement(
  document: Document,
  node: MarkdownNode,
  context: TooltipMarkdownRenderContext,
): HTMLElement {
  const element = document.createElement(node.ordered === true ? 'ol' : 'ul')
  applyStyles(element, {
    margin: '0',
    paddingLeft: '18px',
  })
  appendChildren(element, document, node.children ?? [], context)
  return element
}

function listItemElement(
  document: Document,
  node: MarkdownNode,
  context: TooltipMarkdownRenderContext,
): HTMLElement {
  const element = document.createElement('li')
  if (typeof node.checked === 'boolean') element.append(taskCheckbox(document, node.checked))
  appendChildren(element, document, node.children ?? [], context)
  return element
}

function taskCheckbox(document: Document, checked: boolean): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = checked
  input.disabled = true
  input.tabIndex = -1
  applyStyles(input, {
    margin: '0 6px 0 0',
    verticalAlign: '-1px',
  })
  return input
}

function tableElement(
  document: Document,
  node: MarkdownNode,
  context: TooltipMarkdownRenderContext,
): HTMLElement {
  const table = document.createElement('table')
  const rows = node.children ?? []
  applyStyles(table, {
    borderCollapse: 'collapse',
    fontSize: '12px',
  })
  appendTableHead(table, document, rows[0] ?? null, node.align ?? [], context)
  appendTableBody(table, document, rows.slice(1), node.align ?? [], context)
  return table
}

function appendTableHead(
  table: HTMLTableElement,
  document: Document,
  row: MarkdownNode | null,
  align: readonly (string | null | undefined)[],
  context: TooltipMarkdownRenderContext,
): void {
  if (!row) return

  const head = document.createElement('thead')
  head.append(tableRowElement(document, row, 'th', align, context))
  table.append(head)
}

function appendTableBody(
  table: HTMLTableElement,
  document: Document,
  rows: readonly MarkdownNode[],
  align: readonly (string | null | undefined)[],
  context: TooltipMarkdownRenderContext,
): void {
  if (rows.length === 0) return

  const body = document.createElement('tbody')
  for (const row of rows) body.append(tableRowElement(document, row, 'td', align, context))
  table.append(body)
}

function tableRowElement(
  document: Document,
  row: MarkdownNode,
  cellTagName: 'td' | 'th',
  align: readonly (string | null | undefined)[],
  context: TooltipMarkdownRenderContext,
): HTMLTableRowElement {
  const element = document.createElement('tr')
  const cells = row.children ?? []
  for (let index = 0; index < cells.length; index += 1) {
    element.append(tableCellElement(document, cells[index]!, cellTagName, align[index], context))
  }
  return element
}

function tableCellElement(
  document: Document,
  node: MarkdownNode,
  tagName: 'td' | 'th',
  align: string | null | undefined,
  context: TooltipMarkdownRenderContext,
): HTMLTableCellElement {
  const element = document.createElement(tagName)
  applyStyles(element, {
    padding: '3px 7px',
    border: '1px solid color-mix(in srgb, var(--editor-foreground, #a1a1aa) 22%, transparent)',
    textAlign: tableTextAlign(align),
  })
  appendChildren(element, document, node.children ?? [], context)
  return element
}

function headingElement(
  document: Document,
  node: MarkdownNode,
  context: TooltipMarkdownRenderContext,
): HTMLElement {
  const element = parentElement(document, 'div', node, context)
  element.setAttribute('role', 'heading')
  element.setAttribute('aria-level', String(headingDepth(node.depth)))
  applyStyles(element, {
    fontWeight: '650',
  })
  return element
}

function blockquoteElement(
  document: Document,
  node: MarkdownNode,
  context: TooltipMarkdownRenderContext,
): HTMLElement {
  const element = parentElement(document, 'blockquote', node, context)
  applyStyles(element, {
    margin: '0',
    paddingLeft: '10px',
    borderLeft: '2px solid color-mix(in srgb, var(--editor-foreground, #a1a1aa) 46%, transparent)',
    color: 'color-mix(in srgb, var(--editor-foreground, #d4d4d8) 86%, transparent)',
  })
  return element
}

function fallbackNode(
  document: Document,
  node: MarkdownNode,
  context: TooltipMarkdownRenderContext,
): Node | null {
  if (typeof node.value === 'string') return document.createTextNode(node.value)
  if (!node.children || node.children.length === 0) return null

  const element = document.createElement('span')
  appendChildren(element, document, node.children, context)
  return element
}

function safeLinkHref(url: unknown): string | null {
  if (typeof url !== 'string') return null

  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href
    if (parsed.protocol === 'mailto:') return parsed.href
    return null
  } catch {
    return null
  }
}

function tableTextAlign(align: string | null | undefined): string {
  if (align === 'left' || align === 'right' || align === 'center') return align
  return 'left'
}

function headingDepth(depth: unknown): number {
  if (typeof depth !== 'number') return 2
  return Math.min(6, Math.max(1, Math.trunc(depth)))
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function applyStyles(element: HTMLElement, styles: Readonly<Record<string, string>>): void {
  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(cssPropertyName(property), value)
  }
}

function cssPropertyName(property: string): string {
  return property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
}
