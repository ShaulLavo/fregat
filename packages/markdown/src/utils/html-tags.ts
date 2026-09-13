import { htmlVoidElements } from 'html-void-elements'

const TAG = /<(\/?)([A-Za-z][\w:-]*)(?:\s[^>]*?)?(\/?)>/g
const COMMENT_OR_CDATA = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g

const VOID_TAGS = new Set(htmlVoidElements)

/** Elements the HTML parser closes on its own; a missing end tag pins nothing. */
const OPTIONAL_END_TAGS = new Set([
  'body',
  'colgroup',
  'dd',
  'dt',
  'head',
  'html',
  'li',
  'optgroup',
  'option',
  'p',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
])

/**
 * Feeds one block of raw HTML into a stack of tags it left open. A block
 * boundary is only safe where the stack is empty: `<details>` on one line and
 * `</details>` ten paragraphs later must reach the HTML parser together.
 */
export function trackOpenHtmlTags(stack: string[], html: string): void {
  for (const match of html.replace(COMMENT_OR_CDATA, '').matchAll(TAG)) {
    const closing = match[1] === '/'
    const name = (match[2] ?? '').toLowerCase()
    const selfClosing = match[3] === '/'
    if (VOID_TAGS.has(name) || OPTIONAL_END_TAGS.has(name) || selfClosing) continue
    if (!closing) {
      stack.push(name)
      continue
    }

    const index = stack.lastIndexOf(name)
    if (index === -1) continue
    stack.length = index
  }
}
