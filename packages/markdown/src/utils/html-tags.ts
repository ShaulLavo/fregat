const TAG = /<(\/?)([A-Za-z][\w:-]*)(?:\s[^>]*?)?(\/?)>/g

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/**
 * Feeds one block of raw HTML into a stack of tags it left open. A block
 * boundary is only safe where the stack is empty: `<details>` on one line and
 * `</details>` ten paragraphs later must reach the HTML parser together.
 */
export function trackOpenHtmlTags(stack: string[], html: string): void {
  for (const match of html.matchAll(TAG)) {
    const closing = match[1] === '/'
    const name = (match[2] ?? '').toLowerCase()
    const selfClosing = match[3] === '/'
    if (VOID_TAGS.has(name) || selfClosing) continue
    if (!closing) {
      stack.push(name)
      continue
    }

    const index = stack.lastIndexOf(name)
    if (index === -1) continue
    stack.length = index
  }
}
