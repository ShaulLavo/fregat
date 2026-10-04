import { unzipSync } from 'fflate'
import { sanitizeErrorCause } from '../observability/logging'
import { isEvlogError } from '../observability/structured-errors'
import * as v from 'valibot'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { fontOperationFailed, readBinaryFile, readJsonFile } from './cache-files'
import { isValidFontName } from './contracts'
import type { Fetcher, FontSubsetter } from './fetcher'
import { Inflight } from './inflight'
import { fontErrors } from './structured-errors'

export type FontLinks = Record<string, string>

type NerdFontProviderOptions = {
  cacheRoot: string
  fetcher: Fetcher
  subsetter: FontSubsetter
}

const nerdFontsDownloadUrl = 'https://api.github.com/repos/ryanoasis/nerd-fonts/releases/latest'
// A face downloads by name from the latest release: the release API is rate-limited to 60 an
// hour per address, and every window asks for the symbols font before the catalog.
const latestArchiveUrl = (name: string) =>
  `https://github.com/ryanoasis/nerd-fonts/releases/latest/download/${name}.zip`
const releaseSchema = v.object({
  assets: v.array(v.object({ browser_download_url: v.string() })),
})
// Only Nerd Fonts release assets may be fetched.
const archiveHosts = new Set(['github.com'])
// The release metadata is small; an archive can be tens of MB.
const LINKS_TIMEOUT_MS = 10_000
const ARCHIVE_TIMEOUT_MS = 120_000

/** Nerd Fonts release assets; each archive's Regular face is cached as ttf. */
export class NerdFontProvider {
  private readonly fetcher: Fetcher
  private readonly fontDirectory: string
  private readonly linksFile: string
  private readonly previewDirectory: string
  private readonly subsetter: FontSubsetter
  private readonly inflight = new Inflight()

  constructor(options: NerdFontProviderOptions) {
    this.fetcher = options.fetcher
    this.fontDirectory = path.join(options.cacheRoot, 'files')
    this.linksFile = path.join(options.cacheRoot, 'font-links.json')
    this.previewDirectory = path.join(options.cacheRoot, 'previews')
    this.subsetter = options.subsetter
  }

  links(): Promise<FontLinks> {
    return this.inflight.join('links', () => this.readLinks())
  }

  private async readLinks() {
    await this.ensureCacheDirectories()

    const cached = await readJsonFile<FontLinks>(this.linksFile)
    if (cached) return cached

    const response = await this.fetcher(nerdFontsDownloadUrl, {
      signal: AbortSignal.timeout(LINKS_TIMEOUT_MS),
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw fontOperationFailed('failed to fetch Nerd Fonts links', response)

    const links = parseNerdFontLinks(await response.json())
    await writeFile(this.linksFile, JSON.stringify(links, null, 2))

    return links
  }

  font(fontName: string): Promise<Buffer | null> {
    if (!isValidFontName(fontName)) return Promise.resolve(null)

    // The picker's samples and the face itself can all ask for one cold archive at once.
    return this.inflight.join(`font:${fontName}`, () => this.readFont(fontName))
  }

  private async readFont(fontName: string) {
    let stage = 'cache_read'
    try {
      await this.ensureCacheDirectories()
      const cachedFontPath = path.join(this.fontDirectory, `${fontName}.ttf`)
      const cachedFont = await readBinaryFile(cachedFontPath)
      if (cachedFont) return cachedFont

      stage = 'download'
      const zipBuffer = await this.downloadFontZip(latestArchiveUrl(fontName))
      if (!zipBuffer) return null

      stage = 'archive'
      const fontBuffer = extractRegularFont(zipBuffer)
      if (!fontBuffer) return null

      stage = 'cache_write'
      await writeFile(cachedFontPath, fontBuffer)
      return fontBuffer
    } catch (cause) {
      if (isEvlogError(cause)) throw cause
      throw fontErrors.UNAVAILABLE({
        internal: {
          stage,
          cause: cause instanceof Error ? sanitizeErrorCause(cause) : { type: typeof cause },
        },
      })
    }
  }

  async preview(fontName: string, previewText: string, textHash: string) {
    if (!isValidFontName(fontName)) return null

    await this.ensureCacheDirectories()

    const cachedPreviewPath = path.join(this.previewDirectory, `${fontName}-${textHash}.woff2`)
    const cachedPreview = await readBinaryFile(cachedPreviewPath)
    if (cachedPreview) return cachedPreview

    const fullFont = await this.font(fontName)
    if (!fullFont) return null

    const subset = await this.subsetter(fullFont, previewText, { targetFormat: 'woff2' })
    await writeFile(cachedPreviewPath, subset)

    return subset
  }

  private async downloadFontZip(zipUrl: string) {
    const response = await this.fetcher(zipUrl, { signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS) })
    if (response.status === 404) return null
    if (!response.ok)
      throw fontErrors.UNAVAILABLE({
        internal: { stage: 'download', upstreamStatus: response.status },
      })

    return Buffer.from(await response.arrayBuffer())
  }

  private async ensureCacheDirectories() {
    await mkdir(this.fontDirectory, { recursive: true })
    await mkdir(this.previewDirectory, { recursive: true })
  }
}

export function parseNerdFontLinks(release: unknown): FontLinks {
  const { assets } = v.parse(releaseSchema, release)
  const links: FontLinks = {}
  for (const asset of assets) {
    const parsed = parsedFontLink(asset.browser_download_url)
    if (parsed) links[parsed.name] = parsed.url
  }
  return links
}

function extractRegularFont(zipBuffer: Buffer) {
  const files: string[] = []
  // Read the directory first so only the selected face is inflated.
  unzipSync(zipBuffer, {
    filter: ({ name }) => {
      if (name.endsWith('.ttf') || name.endsWith('.otf')) files.push(name)
      return false
    },
  })
  const filename = files.find(isRegularFontFile) ?? files[0]
  if (!filename) return null
  const extracted = unzipSync(zipBuffer, { filter: ({ name }) => name === filename })
  const font = extracted[filename]
  return font ? Buffer.from(font) : null
}

function isRegularFontFile(filename: string) {
  if (filename.includes('Windows Compatible')) return false

  return filename.endsWith('Regular.ttf') || filename.endsWith('Regular.otf')
}

function parsedFontLink(href: string | undefined) {
  if (!href) return null

  const url = URL.parse(href)
  if (!url || url.protocol !== 'https:') return null
  if (!archiveHosts.has(url.hostname)) return null
  if (!url.pathname.startsWith('/ryanoasis/nerd-fonts/releases/download/')) return null
  if (!url.pathname.endsWith('.zip')) return null

  const name = path.basename(url.pathname, '.zip')
  if (!isValidFontName(name)) return null

  return { name, url: url.href }
}
