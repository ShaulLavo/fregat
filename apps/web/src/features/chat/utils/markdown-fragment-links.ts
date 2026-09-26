import { MARKDOWN_ID_PREFIX } from '@workspace/markdown'

/**
 * `#fragment` links inside a message have nowhere to navigate to — the app is
 * not a document at a URL — so they are resolved against the rendered message
 * itself. The renderer emits headings without ids, so a heading is matched by
 * the GitHub-style slug of its own text. The renderer prefixes every id and
 * in-document link, so the prefix is dropped before matching a slug.
 */

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'
const NON_SLUG_CHARACTERS = /[^\p{L}\p{N} _-]+/gu

function markdownFragmentId(href: string | undefined) {
  if (!href?.startsWith('#')) return null

  const raw = href.slice(1)
  if (!raw) return null

  return decodeFragment(raw)
}

/**
 * The link's own message wins, so two turns that both head a section "Plan"
 * each jump to their own. A transcript-wide pass follows, because agents also
 * refer back to a heading from an earlier turn.
 */
export function findMarkdownFragmentTarget(anchor: Element, href: string | undefined) {
  const fragment = markdownFragmentId(href)
  if (!fragment) return null

  const message = anchor.closest('[data-chat-markdown]')
  const local = message ? targetWithin(message, fragment) : null
  if (local) return local

  const body = anchor.ownerDocument.body
  if (!body) return null

  return targetWithin(body, fragment)
}

function targetWithin(root: Element, fragment: string) {
  const slug = fragment.startsWith(MARKDOWN_ID_PREFIX)
    ? fragment.slice(MARKDOWN_ID_PREFIX.length)
    : fragment
  return elementWithId(root, fragment) ?? headingWithSlug(root, slug)
}

function markdownHeadingSlug(text: string) {
  return text.trim().toLowerCase().replace(NON_SLUG_CHARACTERS, '').replaceAll(' ', '-')
}

function decodeFragment(raw: string) {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function elementWithId(root: Element, fragment: string) {
  for (const candidate of root.querySelectorAll<HTMLElement>('[id]')) {
    if (candidate.id !== fragment) continue

    return candidate
  }

  return null
}

function headingWithSlug(root: Element, fragment: string) {
  const slug = markdownHeadingSlug(fragment)
  if (!slug) return null

  for (const heading of root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
    if (markdownHeadingSlug(heading.textContent ?? '') !== slug) continue

    return heading
  }

  return null
}
