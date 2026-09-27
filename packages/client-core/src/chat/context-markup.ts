/**
 * Escaping for the XML-shaped context blocks a composer appends to a prompt. Captured text can
 * then never close a tag it did not open.
 */
const ESCAPES: Readonly<Record<string, string>> = {
  '"': '&quot;',
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}
const UNESCAPES: Readonly<Record<string, string>> = {
  amp: '&',
  gt: '>',
  lt: '<',
  quot: '"',
}

export function escapeContextMarkup(text: string) {
  return text.replace(/["&<>]/g, (character) => ESCAPES[character] ?? character)
}

/**
 * One pass, so text that was literally `&lt;` before capture comes back as
 * `&lt;` rather than being unescaped a second time into `<`.
 */
export function unescapeContextMarkup(text: string) {
  return text.replace(/&(amp|lt|gt|quot);/g, (match, entity: string) => UNESCAPES[entity] ?? match)
}
