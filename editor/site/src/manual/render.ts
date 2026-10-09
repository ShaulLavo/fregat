/**
 * Prerenders a docs page as the rows Singapore's Markdown live preview draws for it. Parsing,
 * capture styles and preview replacements are the editor's own: tree-sitter-md, the fence grammars
 * and queries from `@singapore-editor/tree-sitter-languages`, `treeSitterCapturesToEditorTokens`
 * and `markdownInlineReplacements`. Only the DOM differs: one semantic element per source line.
 * Build time only.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import GithubSlugger from 'github-slugger'
import { CAPTURES, init, Kind, MarkdownDocument } from 'tree-sitter-md'
import { Language, Parser, Query } from 'web-tree-sitter'
import { createStringTextSnapshot } from '@singapore-editor/core/document'
import type { InlineReplacementSpec } from '@singapore-editor/core/rendering'
import {
  treeSitterCapturesToEditorTokens,
  type EditorSyntaxCapture,
} from '@singapore-editor/core/syntax'
import { markdownInlineReplacements } from '@singapore-editor/markdown'
import { fenceLanguage, languageContribution, type FenceLanguageId } from './languages'
import { syntaxClass, syntaxIdForColor } from './theme'

type ManualHeading = {
  readonly level: number
  readonly id: string
  readonly text: string
  readonly line: number
}

export type RenderedRows = {
  readonly html: string
  readonly lineCount: number
}

export type RenderedPage = RenderedRows & {
  readonly title: string
  readonly description: string
  readonly headings: readonly ManualHeading[]
}

/** Where a Markdown link goes on the static page; `md` marks a docs page the editor can open. */
export type LinkTarget = { readonly href: string; readonly md?: string }

const GRAMMARS: Record<FenceLanguageId, string> = {
  typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  json: 'tree-sitter-json/tree-sitter-json.wasm',
  shellscript: 'tree-sitter-bash/tree-sitter-bash.wasm',
}

const require = createRequire(import.meta.url)
// Grammar packages are dependencies of the languages package, not of the site.
const grammarRequire = createRequire(require.resolve('@singapore-editor/tree-sitter-languages'))

let ready: Promise<void> | null = null
const languages = new Map<FenceLanguageId, Promise<{ language: Language; query: Query }>>()

function initialize(): Promise<void> {
  ready ??= init({
    grammar: pathToFileURL(require.resolve('tree-sitter-md/tree-sitter-markdown.wasm')),
    resolver: pathToFileURL(require.resolve('tree-sitter-md/tree-sitter-md.wasm')),
  })
  return ready
}

function grammar(id: FenceLanguageId) {
  let pending = languages.get(id)
  if (!pending) {
    pending = (async () => {
      await initialize()
      const contribution = languageContribution(id)
      const [language, assets] = await Promise.all([
        Language.load(grammarRequire.resolve(GRAMMARS[id])),
        'load' in contribution && contribution.load ? contribution.load() : contribution,
      ])
      return { language, query: new Query(language, assets.highlightQuerySource ?? '') }
    })()
    languages.set(id, pending)
  }
  return pending
}

async function codeCaptures(
  id: FenceLanguageId,
  text: string,
  offset: number,
): Promise<EditorSyntaxCapture[]> {
  const { language, query } = await grammar(id)
  const parser = new Parser()
  parser.setLanguage(language)
  const tree = parser.parse(text)
  if (!tree) throw new TypeError(`tree-sitter could not parse a ${id} sample`)
  const captures = query.captures(tree.rootNode).map((capture) => ({
    startIndex: capture.node.startIndex + offset,
    endIndex: capture.node.endIndex + offset,
    captureName: capture.name,
    languageId: id,
  }))
  tree.delete()
  parser.delete()
  return captures
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Leaf = { readonly text: string; readonly className: string; readonly hidden?: boolean }
type Piece = Leaf | { readonly link: LinkTarget; readonly title: string; readonly leaves: Leaf[] }

const leafHtml = (leaf: Leaf, text: string) => {
  const attributes = [
    leaf.className && `class="${leaf.className}"`,
    leaf.hidden && 'aria-hidden="true"',
  ].filter(Boolean)
  return attributes.length ? `<span ${attributes.join(' ')}>${escape(text)}</span>` : escape(text)
}

/**
 * The editor wraps only at spaces; the browser also breaks after hyphens and slashes. Words
 * holding either stay in one `nowrap` span so both break in the same place.
 */
const NARROWEST_COLUMNS = 32

function leavesHtml(leaves: readonly Leaf[]): string {
  const text = leaves.map((leaf) => leaf.text).join('')
  const cuts = new Set<number>()
  const words: { start: number; end: number; wide: boolean }[] = []
  for (const match of text.matchAll(/\S*[-/]\S*/g)) {
    words.push({
      start: match.index,
      end: match.index + match[0].length,
      // Wider than a 320 px phone row: phones may break it (`.nw.wide`), as the editor would.
      wide: match[0].length > NARROWEST_COLUMNS,
    })
    cuts.add(match.index).add(match.index + match[0].length)
  }
  let html = ''
  let offset = 0
  for (const leaf of leaves) {
    let start = 0
    for (let index = 1; index <= leaf.text.length; index++) {
      if (index < leaf.text.length && !cuts.has(offset + index)) continue
      const word = words.find((candidate) => candidate.start === offset + start)
      if (word) html += word.wide ? '<span class="nw wide">' : '<span class="nw">'
      html += leafHtml(leaf, leaf.text.slice(start, index))
      if (words.some((word) => word.end === offset + index)) html += '</span>'
      start = index
    }
    offset += leaf.text.length
  }
  return html
}

function piecesHtml(pieces: readonly Piece[]): string {
  let html = ''
  let run: Leaf[] = []
  for (const piece of pieces) {
    if (!('link' in piece)) {
      run.push(piece)
      continue
    }
    html += leavesHtml(run)
    run = []
    const md = piece.link.md ? ` data-md="${escape(piece.link.md)}"` : ''
    html += `<a href="${escape(piece.link.href)}"${md} title="${escape(piece.title)}">${leavesHtml(piece.leaves)}</a>`
  }
  return html + leavesHtml(run)
}

const plainText = (pieces: readonly Piece[]) =>
  pieces
    .map((piece) => ('link' in piece ? piece.leaves : [piece]))
    .flat()
    .filter((leaf) => !leaf.hidden)
    .map((leaf) => leaf.text)
    .join('')

type Token = { readonly start: number; readonly end: number; readonly className: string }

function tokenClasses(captures: readonly EditorSyntaxCapture[]): Token[] {
  return treeSitterCapturesToEditorTokens(captures).flatMap((token) => {
    const classes: string[] = []
    if (token.style.color) {
      const id = syntaxIdForColor(token.style.color)
      if (!id) throw new TypeError(`No docs palette colour for token colour ${token.style.color}`)
      classes.push(syntaxClass(id))
    }
    if (token.style.textDecoration?.includes('underline')) classes.push('u')
    return classes.length
      ? [{ start: token.start, end: token.end, className: classes.join(' ') }]
      : []
  })
}

/** Source text in `[start, end)` as leaves coloured by the tokens covering it. */
function sourceLeaves(text: string, tokens: readonly Token[], start: number, end: number): Leaf[] {
  const leaves: Leaf[] = []
  let position = start
  for (const token of tokens) {
    if (token.end <= position) continue
    if (token.start >= end) break
    if (token.start > position)
      leaves.push({ text: text.slice(position, token.start), className: '' })
    const stop = Math.min(token.end, end)
    leaves.push({
      text: text.slice(Math.max(token.start, position), stop),
      className: token.className,
    })
    position = stop
  }
  if (position < end) leaves.push({ text: text.slice(position, end), className: '' })
  return leaves
}

/** The href a rendered link mounts, read through the preview's own render function. */
function replacementHref(spec: InlineReplacementSpec): string {
  let href = ''
  const anchor = {
    set href(value: string) {
      href = value
    },
    addEventListener() {},
  }
  const container = { ownerDocument: { createElement: () => anchor }, append() {} }
  spec.render?.(container as unknown as HTMLElement, spec.text, 0)
  return href
}

const HIDDEN_MARKERS = new Set(['list-marker', 'quote-marker', 'task-marker'])

type Line = { readonly start: number; readonly end: number }

function lineRanges(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (;;) {
    const end = text.indexOf('\n', start)
    lines.push({ start, end: end === -1 ? text.length : end })
    if (end === -1) return lines
    start = end + 1
  }
}

function linePieces(
  text: string,
  line: Line,
  tokens: readonly Token[],
  specs: readonly InlineReplacementSpec[],
  resolveLink: (href: string) => LinkTarget,
): Piece[] {
  const pieces: Piece[] = []
  let position = line.start
  for (const spec of specs) {
    if (spec.startIndex < position)
      throw new TypeError(`Overlapping preview replacements at offset ${spec.startIndex}`)
    pieces.push(...sourceLeaves(text, tokens, position, spec.startIndex))
    position = spec.endIndex
    if (spec.kind === 'link') {
      const href = replacementHref(spec)
      pieces.push({
        link: resolveLink(href),
        title: href,
        leaves: [{ text: spec.text, className: '' }],
      })
      continue
    }
    if (spec.text)
      pieces.push({ text: spec.text, className: '', hidden: HIDDEN_MARKERS.has(spec.kind ?? '') })
  }
  pieces.push(...sourceLeaves(text, tokens, position, line.end))
  return pieces
}

type Block = { readonly kind: number; readonly start: number; readonly end: number; level: number }

const BLOCK_PRIORITY = [Kind.CodeBlock, Kind.Heading, Kind.Table, Kind.ListItem, Kind.BlockQuote]

function lineBlocks(records: Uint32Array, lines: readonly Line[]): (Block | null)[] {
  const blocks: Block[] = []
  const headingLevels = new Map<number, number>()
  for (let index = 0; index < records.length; index += 4) {
    const kind = records[index + 2]!
    if (kind === Kind.HeadingMark) headingLevels.set(records[index]!, records[index + 3]!)
    if (!BLOCK_PRIORITY.includes(kind as (typeof BLOCK_PRIORITY)[number])) continue
    blocks.push({ kind, start: records[index]!, end: records[index + 1]!, level: 0 })
  }
  for (const block of blocks) {
    if (block.kind !== Kind.Heading) continue
    for (const [offset, level] of headingLevels)
      if (offset >= block.start && offset < block.end) block.level = level
  }
  const rank = (block: Block) =>
    BLOCK_PRIORITY.indexOf(block.kind as (typeof BLOCK_PRIORITY)[number])
  return lines.map((line) => {
    let best: Block | null = null
    for (const block of blocks) {
      if (block.start > line.end || block.end <= line.start) continue
      if (
        !best ||
        rank(block) < rank(best) ||
        (block.kind === best.kind && block.start >= best.start)
      )
        best = block
    }
    return best
  })
}

/** Rows for a whole source file in one language, such as the home page sample. */
export async function renderCode(text: string, languageId: FenceLanguageId): Promise<RenderedRows> {
  const tokens = tokenClasses(await codeCaptures(languageId, text, 0))
  const lines = lineRanges(text)
  const rows = lines.map(
    (line, index) =>
      `<span class="r" data-n="${index + 1}">${piecesHtml(sourceLeaves(text, tokens, line.start, line.end))}</span>`,
  )
  return {
    html: `<pre class="code" data-lang="${languageId}"><code>${rows.join('')}</code></pre>`,
    lineCount: lines.length,
  }
}

/** A docs page: rows, headings, and the title and description its first lines give. */
export async function renderMarkdown(
  text: string,
  resolveLink: (href: string) => LinkTarget,
): Promise<RenderedPage> {
  await initialize()
  const document = new MarkdownDocument({ gfm: true })
  document.setText(text)
  const records = document.decorations(0, text.length)
  const highlights = document.highlights(0, text.length)
  const fences = document.injections(0, text.length)
  document.dispose()

  const captures: EditorSyntaxCapture[] = []
  for (let index = 0; index < highlights.length; index += 3) {
    const captureName = CAPTURES[highlights[index + 2]!]
    if (!captureName) continue
    captures.push({
      startIndex: highlights[index]!,
      endIndex: highlights[index + 1]!,
      captureName,
      languageId: 'markdown',
    })
  }
  for (let index = 0; index < fences.length; index += 4) {
    const info = text.slice(fences[index + 2]!, fences[index + 3]!)
    const language = fenceLanguage(info)
    if (language === null)
      throw new TypeError(`The docs editor has no grammar for fence language "${info}"`)
    if (language === 'text') continue
    const start = fences[index]!
    captures.push(...(await codeCaptures(language, text.slice(start, fences[index + 1]!), start)))
  }
  const tokens = tokenClasses(captures.sort((a, b) => a.startIndex - b.startIndex))

  const snapshot = createStringTextSnapshot(text)
  const specs = [...markdownInlineReplacements(snapshot, records)].sort(
    (a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex,
  )
  const lines = lineRanges(text)
  const blocks = lineBlocks(records, lines)
  const slugger = new GithubSlugger()
  const headings: ManualHeading[] = []
  const html: string[] = []
  let description = ''
  let open: { block: Block; close: string } | null = null
  const close = () => {
    if (open) html.push(open.close)
    open = null
  }

  lines.forEach((line, index) => {
    const n = index + 1
    const block = blocks[index]!
    const lineSpecs = specs.filter(
      (spec) =>
        spec.startIndex >= line.start && spec.startIndex <= line.end && spec.endIndex <= line.end,
    )
    const pieces = linePieces(text, line, tokens, lineSpecs, resolveLink)
    const content = piecesHtml(pieces)
    const visible = plainText(pieces)

    if (block?.kind === Kind.CodeBlock) {
      if (open?.block !== block) {
        close()
        html.push('<pre class="code"><code>')
        open = { block, close: '</code></pre>' }
      }
      const fence = !visible.trim() && /^\s*(```|~~~)/.test(text.slice(line.start, line.end))
      html.push(
        fence
          ? `<span class="r" data-n="${n}" aria-hidden="true"></span>`
          : `<span class="r" data-n="${n}">${content}</span>`,
      )
      return
    }
    if (block?.kind === Kind.ListItem) {
      if (open?.block.kind !== Kind.ListItem) {
        close()
        html.push('<ul>')
        open = { block, close: '</ul>' }
      }
      html.push(`<li class="r" data-n="${n}">${content}</li>`)
      return
    }
    if (block?.kind === Kind.BlockQuote) {
      if (open?.block !== block) {
        close()
        html.push('<blockquote>')
        open = { block, close: '</blockquote>' }
      }
      html.push(`<p class="r" data-n="${n}">${content}</p>`)
      return
    }
    close()
    if (!visible.trim() && block?.kind !== Kind.Heading) {
      html.push(`<div class="r" data-n="${n}" aria-hidden="true">${content}</div>`)
      return
    }
    if (block?.kind === Kind.Heading && block.level) {
      const id = slugger.slug(visible.trim())
      headings.push({ level: block.level, id, text: visible.trim(), line: n })
      html.push(
        `<h${block.level} class="r h${block.level}" id="${id}" data-n="${n}">${content}</h${block.level}>`,
      )
      return
    }
    if (!description && block?.kind !== Kind.Table) description = visible.trim()
    html.push(`<p class="r" data-n="${n}">${content}</p>`)
  })
  close()

  const title = headings.find((heading) => heading.level === 1)?.text
  if (!title) throw new TypeError('A docs page starts with a level-one heading')
  return { html: html.join(''), lineCount: lines.length, title, description, headings }
}
