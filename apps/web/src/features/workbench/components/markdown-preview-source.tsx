import { use, type ComponentProps } from 'react'
import { MarkdownPictureContext } from '@/features/workbench/providers/markdown-picture-context'
import { MarkdownPreviewContext } from '@/features/workbench/providers/markdown-preview-context'
import { markdownPreviewImageSource, markdownPreviewTarget } from '@/lib/markdown-mode/utils/paths'

const COLOR_SCHEME_QUERY = /^\s*\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)\s*$/iu
const SPACE = /\s/u

type PreviewPaths = { readonly documentPath: string; readonly rootPath: string }

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
  const scheme = media ? COLOR_SCHEME_QUERY.exec(media)?.[1]?.toLowerCase() : undefined
  return (
    <source
      {...props}
      media={scheme ? (scheme === preview.colorMode ? 'all' : 'not all') : media}
      srcSet={srcSet ? previewSourceSet(srcSet, preview) : undefined}
    />
  )
}

/** A `<picture>` in rendered markdown, which tells its `<img>` when a source is a workspace file. */
export function MarkdownPreviewPicture({
  node,
  ...props
}: ComponentProps<'picture'> & { readonly node?: unknown }) {
  const preview = use(MarkdownPreviewContext)
  const workspace = preview
    ? sourceSets(node).some((set) => loadsFromWorkspace(set, preview))
    : false
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

/** The `srcset` of each `<source>` child of a rendered `<picture>` node. */
function sourceSets(node: unknown): string[] {
  const children = (node as { children?: readonly unknown[] } | undefined)?.children ?? []
  return children.flatMap((child) => {
    const element = child as { tagName?: string; properties?: { srcSet?: unknown } }
    if (element.tagName !== 'source') return []
    const srcSet = element.properties?.srcSet
    if (typeof srcSet === 'string') return [srcSet]
    return Array.isArray(srcSet) ? [srcSet.join(', ')] : []
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
    const descriptorEnd = runEnd(srcSet, urlEnd, (char) => char === ',')
    candidates.push({ url: raw, descriptor: srcSet.slice(urlEnd, descriptorEnd).trim() })
    index = descriptorEnd + 1
  }
  return candidates
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
