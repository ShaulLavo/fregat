/** Moving through a list reads nothing until the selection rests this long. */
export const PREVIEW_SETTLE_MS = 120

/** Enough of a file to recognise it; a preview is not a reader. */
export const PREVIEW_LINES = 40

const IMAGE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
])

export type PreviewContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'binary' }

/** The whole extension, lowercased; it doubles as the highlighter's language alias. */
export function previewExtension(name: string) {
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase()
}

export function isImageName(name: string) {
  return IMAGE_EXTENSIONS.has(previewExtension(name))
}

export function previewLines(content: string) {
  let end = -1
  for (let line = 0; line < PREVIEW_LINES; line += 1) {
    end = content.indexOf('\n', end + 1)
    if (end < 0) return content
  }
  return content.slice(0, end)
}

export function previewImageUrl(origin: string, path: string) {
  return `${origin.replace(/\/+$/u, '')}/fs/blob?${new URLSearchParams({ path })}`
}
