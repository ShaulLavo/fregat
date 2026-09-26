/** Moving through a list reads nothing until the selection rests this long. */
export const PREVIEW_SETTLE_MS = 120

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
  | {
      readonly kind: 'text'
      readonly text: string
      /** The whole file's bytes; `text` is its head when `truncated`. */
      readonly size: number
      readonly truncated: boolean
    }
  | { readonly kind: 'binary' }

/** The whole extension, lowercased; it doubles as the highlighter's language alias. */
export function previewExtension(name: string) {
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase()
}

export function isImageName(name: string) {
  return IMAGE_EXTENSIONS.has(previewExtension(name))
}

/** `1` to the last line's number, one per line, for a gutter beside `text`. */
export function lineNumbers(text: string) {
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  return Array.from({ length: Math.max(lines, 1) }, (_, index) => index + 1).join('\n')
}

export function previewImageUrl(origin: string, path: string) {
  return `${origin.replace(/\/+$/u, '')}/fs/blob?${new URLSearchParams({ path })}`
}
