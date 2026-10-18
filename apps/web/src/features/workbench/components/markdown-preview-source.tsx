import { use, type ComponentProps } from 'react'
import { MarkdownPictureContext } from '@/features/workbench/providers/markdown-picture-context'
import { MarkdownPreviewContext } from '@/features/workbench/providers/markdown-preview-context'
import { markdownPreviewImageSource, markdownPreviewTarget } from '@/lib/markdown-mode/utils/paths'

const COLOR_SCHEME_QUERY = /^\s*\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)\s*$/iu
const SPACE = /\s/u

type PreviewPaths = { readonly documentPath: string; readonly rootPath: string }
type Preview = PreviewPaths & { readonly colorMode: 'light' | 'dark' }
// The sanitizer keeps only `srcset` and `media` on a source, so a `type` never reaches the browser.
type SourceNode = { readonly srcSet: string; readonly media: string | undefined }

/**
 * A `<picture>` source in rendered markdown: its images load from the workspace like `<img>`,
 * and a light or dark variant follows the app's colour mode, the one the reader sees.
 */
export function MarkdownPreviewSource({
  media,
  node: _node,
  srcSet,
  ...props
}: ComponentProps<'source'> & { readonly node?: unknown }) {
  const preview = use(MarkdownPreviewContext)
  if (!preview) return <source {...props} media={media} srcSet={srcSet} />
  return (
    <source
      {...props}
      media={previewMedia(media, preview.colorMode)}
      srcSet={srcSet ? previewSourceSet(srcSet, preview) : undefined}
    />
  )
}

/** A light or dark query answered by the app's colour mode; any other query left to the browser. */
function previewMedia(media: string | undefined, colorMode: Preview['colorMode']) {
  const scheme = media ? COLOR_SCHEME_QUERY.exec(media)?.[1]?.toLowerCase() : undefined
  if (!scheme) return media
  return scheme === colorMode ? 'all' : 'not all'
}

/**
 * A `<picture>` in rendered markdown, which tells its `<img>` when the source the browser will pick
 * is a workspace file: that request needs CORS, and an external image that sends no CORS headers
 * would fail with it.
 */
export function MarkdownPreviewPicture({
  node,
  ...props
}: ComponentProps<'picture'> & { readonly node?: unknown }) {
  const preview = use(MarkdownPreviewContext)
  const chosen = preview
    ? pictureSources(node).find((source) => applies(source, preview) !== false)
    : undefined
  // The chosen source decides the request mode; with none, the image's own `src` does. A source
  // that depends on the screen (a width query) asks for no CORS: an external image without CORS
  // headers would otherwise fail.
  const workspace =
    preview && chosen
      ? applies(chosen, preview) === true && loadsFromWorkspace(chosen.srcSet, preview)
      : null
  return (
    <MarkdownPictureContext value={workspace}>
      <picture {...props} />
    </MarkdownPictureContext>
  )
}

function previewSourceSet(srcSet: string, preview: PreviewPaths & { readonly origin: string }) {
  return sourceSetCandidates(srcSet)
    .map(({ url, descriptor }) => {
      const source = markdownPreviewImageSource(
        url,
        preview.documentPath,
        preview.rootPath,
        preview.origin,
      )
      if (!source) return null
      return descriptor ? `${source} ${descriptor}` : source
    })
    .filter((candidate) => candidate !== null)
    .join(', ')
}

function loadsFromWorkspace(srcSet: string, preview: PreviewPaths) {
  return sourceSetCandidates(srcSet).some(
    ({ url }) => markdownPreviewTarget(url, preview.documentPath, preview.rootPath).kind === 'file',
  )
}

/** Whether the browser takes this source: known for colour-scheme queries, `undefined` otherwise. */
function applies(source: SourceNode, preview: Preview): boolean | undefined {
  const media = previewMedia(source.media, preview.colorMode)
  if (media === 'not all') return false
  if (media && media !== 'all') return undefined
  return true
}

/** Each `<source>` child of a rendered `<picture>` node, in document order. */
function pictureSources(node: unknown): SourceNode[] {
  const children = (node as { children?: readonly unknown[] } | undefined)?.children ?? []
  return children.flatMap((child) => {
    const element = child as {
      tagName?: string
      properties?: { srcSet?: unknown; media?: unknown }
    }
    if (element.tagName !== 'source') return []
    const raw = element.properties?.srcSet
    const srcSet = Array.isArray(raw) ? raw.join(', ') : raw
    if (typeof srcSet !== 'string') return []
    const media = element.properties?.media
    return [{ srcSet, media: typeof media === 'string' ? media : undefined }]
  })
}

/**
 * The candidates of a `srcset`, split the way browsers do: a URL runs to the next space, so the
 * comma inside a `data:` URL stays in it, and a descriptor runs to the next comma.
 */
export function sourceSetCandidates(
  srcSet: string,
): { readonly url: string; readonly descriptor: string }[] {
  const candidates: { url: string; descriptor: string }[] = []
  let index = 0
  while (index < srcSet.length) {
    index = skipSeparators(srcSet, index)
    if (index >= srcSet.length) break
    const urlEnd = runEnd(srcSet, index, (char) => SPACE.test(char))
    const raw = srcSet.slice(index, urlEnd)
    // A URL ending in commas ends its candidate there, with no descriptor.
    if (raw.endsWith(',')) {
      candidates.push({ url: raw.replace(/,+$/u, ''), descriptor: '' })
      index = urlEnd
      continue
    }
    const descriptorEnd = descriptorRunEnd(srcSet, urlEnd)
    candidates.push({ url: raw, descriptor: srcSet.slice(urlEnd, descriptorEnd).trim() })
    index = descriptorEnd + 1
  }
  return candidates
}

/** Where a descriptor ends: the next comma outside parentheses, or the end. */
function descriptorRunEnd(text: string, from: number) {
  let depth = 0
  let index = from
  for (; index < text.length; index += 1) {
    const char = text[index]
    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) break
  }
  return index
}

function skipSeparators(text: string, from: number) {
  return runEnd(text, from, (char) => !SPACE.test(char) && char !== ',')
}

/** The index of the first character from `from` that `stops` accepts, or the end. */
function runEnd(text: string, from: number, stops: (char: string) => boolean) {
  let index = from
  while (index < text.length && !stops(text[index] ?? '')) index += 1
  return index
}
