import {
  EDITOR_PASTE_HANDLER,
  type EditorLanguageFeatureRegistry,
  type EditorLanguageFeatureSelector,
  type EditorPasteHandler,
} from '../plugins'

/** A scheme a link can actually be followed to, as opposed to any text with a colon in it. */
const ABSOLUTE_URL = /^(?:https?|ftp|mailto):\S+$/i

const IMAGE_FILE_NAME = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i

/**
 * Below the default so that a host answering for the same types is asked first. These are what a
 * document nobody has said anything more specific about does with a payload it cannot insert.
 */
const BUILT_IN_PASTE_HANDLER_SELECTOR: EditorLanguageFeatureSelector = {
  language: '*',
  priority: -1,
}

/** How a language writes a reference to somewhere else, which is all these handlers produce. */
type LinkSyntax = {
  readonly link: (label: string, url: string) => string
  readonly image: (label: string, url: string) => string
}

const MARKDOWN_LINKS: LinkSyntax = {
  image: (label, url) => `![${markdownLabel(label)}](${markdownUrl(url)})`,
  link: (label, url) => `[${markdownLabel(label)}](${markdownUrl(url)})`,
}

const HTML_LINKS: LinkSyntax = {
  image: (label, url) => `<img src="${htmlAttribute(url)}" alt="${htmlAttribute(label)}">`,
  link: (label, url) => `<a href="${htmlAttribute(url)}">${htmlText(label)}</a>`,
}

// Only the languages that have one syntax for this rather than a convention per framework. A
// language absent here declines both handlers below and pastes the way it always has.
const LINK_SYNTAX = new Map<string, LinkSyntax>([
  ['html', HTML_LINKS],
  ['markdown', MARKDOWN_LINKS],
  ['md', MARKDOWN_LINKS],
])

/**
 * A URL landing on a word: the word becomes the link text instead of being thrown away.
 *
 * Every caret holding text gets a link; the rest take the URL itself, because brackets around
 * nothing are a worse answer than the paste the user would otherwise have got.
 */
const urlPasteHandler: EditorPasteHandler = {
  handlePaste: (context) => {
    const syntax = LINK_SYNTAX.get(context.languageId ?? '')
    if (!syntax) return null

    const url = context.text.trim()
    if (!ABSOLUTE_URL.test(url)) return null
    if (!context.targets.some((target) => isLinkLabel(target.text))) return null

    return context.targets.map((target) =>
      isLinkLabel(target.text) ? syntax.link(target.text, url) : context.text,
    )
  },
  mimeTypes: ['text/plain'],
}

/**
 * A file with no text beside it, which reaches the document as nothing at all otherwise.
 *
 * What goes in is a reference by name, not the file: nothing here can put its bytes anywhere a
 * link would resolve. A host that can — an upload, a copy into the workspace — registers ahead of
 * this one and writes the location it made instead.
 */
const filePasteHandler: EditorPasteHandler = {
  handlePaste: (context) => {
    const syntax = LINK_SYNTAX.get(context.languageId ?? '')
    if (!syntax) return null
    if (context.files.length === 0) return null
    // A transfer carrying text as well is a text paste that happens to name a file, and the text
    // is what the user was looking at when they copied it.
    if (context.text.length > 0) return null

    const references = context.files.map((file) => fileReference(syntax, file)).join(' ')
    return context.targets.map(() => references)
  },
  mimeTypes: ['Files'],
}

const BUILT_IN_PASTE_HANDLERS: readonly EditorPasteHandler[] = [urlPasteHandler, filePasteHandler]

/** Registered per editor, in the same channel a plugin registers into and behind everything in it. */
export function registerBuiltInPasteHandlers(registry: EditorLanguageFeatureRegistry): void {
  for (const handler of BUILT_IN_PASTE_HANDLERS)
    registry.register(EDITOR_PASTE_HANDLER, BUILT_IN_PASTE_HANDLER_SELECTOR, handler)
}

/** The types a transfer says it carries, as it reported them. */
export function dataTransferTypes(transfer: DataTransfer): readonly string[] {
  return Array.from(transfer.types ?? [])
}

/**
 * Case-insensitively, because the type a browser reports for files is capitalised where every
 * MIME type beside it is not, and a handler naming either spelling means the same thing.
 */
export function pasteHandlerMatchesTypes(
  handler: EditorPasteHandler,
  types: readonly string[],
): boolean {
  return handler.mimeTypes.some((mimeType) =>
    types.some((type) => type.toLowerCase() === mimeType.toLowerCase()),
  )
}

/** Text worth turning into a label: something, on one line, that is not already a link. */
function isLinkLabel(text: string): boolean {
  if (text.length === 0) return false
  if (text.includes('\n')) return false

  return !ABSOLUTE_URL.test(text.trim())
}

function fileReference(syntax: LinkSyntax, file: File): string {
  const name = file.name.length > 0 ? file.name : 'file'
  const isImage = file.type.startsWith('image/') || IMAGE_FILE_NAME.test(name)

  return isImage ? syntax.image(name, name) : syntax.link(name, name)
}

/** A bracket left as it is would end the label early, so both are escaped the way markdown says. */
function markdownLabel(label: string): string {
  return label.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
}

/** A destination with a space or a paren in it only parses inside angle brackets. */
function markdownUrl(url: string): string {
  return /[\s()]/.test(url) ? `<${url}>` : url
}

function htmlAttribute(value: string): string {
  return htmlText(value).replaceAll('"', '&quot;')
}

function htmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
